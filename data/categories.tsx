import { Hono } from "hono";
import { Bindings } from "../types/types";
import prismaClients from "../src/lib/prismaClients";
import { Producto } from "../types/Product";

const newRouterCategories = new Hono<{ Bindings: Bindings }>();
// saber la categoria a apartir de un ID del producto

newRouterCategories.get("/", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const showNews = c.req.query("showNews") === "true";

  const categorias = await prisma.categoria.findMany({
    orderBy: {
      position: 'asc'
    }
  });

  // Si showNews es true, agregar el conteo de productos nuevos
  if (showNews) {
    // Calcular la fecha de hace 7 días
    const hace7Dias = new Date();
    hace7Dias.setDate(hace7Dias.getDate() - 7);

    // Obtener el conteo de productos nuevos agrupados por categoría
    const productosNuevosPorCategoria = await prisma.producto.groupBy({
      by: ['categoryId'],
      where: {
        createdAt: {
          gte: hace7Dias
        }
      },
      _count: {
        id: true
      }
    });

    // Crear un mapa para acceso rápido
    const newsCountMap = new Map(
      productosNuevosPorCategoria.map(item => [item.categoryId, item._count.id])
    );

    // Agregar newsProducts a cada categoría
    const categoriasConNews = categorias.map(categoria => ({
      ...categoria,
      newsProducts: newsCountMap.get(categoria.id) || 0
    }));

    return c.json(categoriasConNews);
  }

  return c.json(categorias);
});
newRouterCategories.get("/producto/:id", async (c) => {
  const { id } = c.req.param();
  const prisma = await prismaClients.fetch(c.env.DB);

  const categoria = await prisma.categoria.findUnique({
    where: {
      id: id,
    },
  });

  return c.json(categoria);
});
// saber la categoria a apartir de un categoryId del producto (para codig viejo)
newRouterCategories.get("/producto/old/:id", async (c) => {
  const { id } = c.req.param();
  const prisma = await prismaClients.fetch(c.env.DB);

  const categoria = await prisma.categoria.findUnique({
    where: {
      categoryId: id,
    },
  });

  return c.json(categoria);
});

newRouterCategories.post("/create", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const body = await c.req.json();

  if (!Array.isArray(body)) {
    return c.json({ error: "El cuerpo debe ser un array de categorías" }, 400);
  }

  for (const cat of body) {
    console.log(cat);
    await prisma.categoria.upsert({
      where: { categoryId: cat.categoryId },
      update: {}, // no actualiza si ya existe
      create: {
        seoTitle: cat.seoTitle,
        categoryId: cat.categoryId,
        img: cat.img,
        imagenPrefijo: cat.imagenPrefijo ?? "",
        title: cat.title,
      },
    });
  }

  return c.json({ message: "Categorías creadas o ya existentes detectadas" });
});

newRouterCategories.get("/img/from/producto/:id", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const { id } = c.req.param();
  try {
    const producto = await prisma.producto.findFirst({
      orderBy: {
        createdAt: "desc", // el campo de fecha que tengas en tu modelo
      },
      include: {
        variants: {
          take: 1,
          include: {
            images: {
              take: 2,
            },
          },
        },
      },
    });
    return c.json(producto?.variants[0]?.images || []);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener productos" }, 500);
  }
});

// newRouterCategories.get("/products/by-category/:categoryId", async (c) => {
//   const prisma = await prismaClients.fetch(c.env.DB);

//   const { categoryId } = c.req.param();
//   const page = parseInt(c.req.query("page") || "1");
//   const limit = parseInt(c.req.query("limit") || "5");

//   if (!categoryId) {
//     return c.json({ error: "Falta categoryId" }, 400);
//   }

//   const skip = (page - 1) * limit;

//   try {
//     const productos = await prisma.producto.findMany({
//       where: { categoryId },
//       skip,
//       take: limit,
//       include: {
//         variants: {
//           take: 1,
//           include: {
//             images: {
//               take: 2,
//             },
//           },
//         }, // ajustalo si querés menos info
//       },
//     });

//     const total = await prisma.producto.count({
//       where: { categoryId },
//     });

//     const hasNextPage = skip + productos.length < total;

//     return c.json({ productos, hasNextPage });
//   } catch (error) {
//     console.error(error);
//     return c.json({ error: "Error al obtener productos" }, 500);
//   }
// });

newRouterCategories.get("/products/by-category/:categoryId", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  const { categoryId } = c.req.param();
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "5");

  const sortByPrice = c.req.query("sortByPrice"); // "asc" o "desc"
  const sortByDate = c.req.query("sortByDate"); // "asc" o "desc"
  const showAllProducto = c.req.query("all");

  // Nuevos filtros avanzados
  const minPrice = c.req.query("minPrice");
  const maxPrice = c.req.query("maxPrice");
  const colors = c.req.query("colors"); // Colores separados por coma: "rojo,azul,verde"

  if (!categoryId) {
    return c.json({ error: "Falta categoryId" }, 400);
  }

  const skip = (page - 1) * limit;

  // Armado dinámico del where
  const where: any = { categoryId };

  // Filtro por rango de precio
  if (minPrice || maxPrice) {
    where.price = {};
    if (minPrice) where.price.gte = parseFloat(minPrice);
    if (maxPrice) where.price.lte = parseFloat(maxPrice);
  }

  // Filtro por colores
  if (colors) {
    const colorsArray = colors.split(",").map((c) => c.trim());
    where.variants = {
      some: {
        colors: {
          some: {
            color: { in: colorsArray },
          },
        },
      },
    };
  }

  // Armado dinámico del ordenamiento
  const orderBy: any[] = [];

  if (sortByPrice === "asc" || sortByPrice === "desc") {
    orderBy.push({ price: sortByPrice });
  }

  if (sortByDate === "asc" || sortByDate === "desc") {
    orderBy.push({ createdAt: sortByDate });
  }

  try {
    var productos: any[] = [];
    if (showAllProducto) {
      productos = await prisma.producto.findMany({
        where,
        orderBy: orderBy.length > 0 ? orderBy : undefined,
      });
    } else {
      productos = await prisma.producto.findMany({
        where,
        skip,
        take: limit,
        orderBy: orderBy.length > 0 ? orderBy : undefined,
        include: {
          variants: {
            take: 1,
            include: {
              colors: {
                take: 1,
              },
              images: {
              
                take: 3,
              },
            },
          },
        },
      });
    }

    const total = await prisma.producto.count({
      where,
    });

    const hasNextPage = skip + productos.length < total;

    return c.json({ productos, hasNextPage });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener productos" }, 500);
  }
});
newRouterCategories.get("/products/by-category/:categoryId/colors", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const { categoryId } = c.req.param();

  if (!categoryId) {
    return c.json({ error: "Falta categoryId" }, 400);
  }

  try {
    // Obtener todos los productos de la categoría con sus variantes y colores
    const productos = await prisma.producto.findMany({
      where: { categoryId },
      include: {
        variants: {
          include: {
            colors: true,
          },
        },
      },
    });

    // Extraer todos los colores únicos
    const coloresSet = new Set<string>();

    productos.forEach((producto) => {
      producto.variants.forEach((variant) => {
        variant.colors.forEach((color) => {
          if (color.color) {
            coloresSet.add(color.color.toLowerCase().trim());
          }
        });
      });
    });

    // Convertir Set a array ordenado alfabéticamente
    const coloresUnicos = Array.from(coloresSet).sort();

    return c.json({
      categoryId,
      totalColors: coloresUnicos.length,
      colors: coloresUnicos,
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener colores de la categoría" }, 500);
  }
});

newRouterCategories.get("/products/by-category/:categoryId/all", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  const { categoryId } = c.req.param();
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "5");

  const sortByPrice = c.req.query("sortByPrice"); // "asc" o "desc"
  const sortByDate = c.req.query("sortByDate"); // "asc" o "desc"

  if (!categoryId) {
    return c.json({ error: "Falta categoryId" }, 400);
  }

  const skip = (page - 1) * limit;

  // Armado dinámico del ordenamiento
  const orderBy: any[] = [];

  if (sortByPrice === "asc" || sortByPrice === "desc") {
    orderBy.push({ price: sortByPrice });
  }

  if (sortByDate === "asc" || sortByDate === "desc") {
    orderBy.push({ createdAt: sortByDate });
  }

  try {
    const productos = await prisma.producto.findMany({
      where: { categoryId },
    });

    const total = await prisma.producto.count({
      where: { categoryId },
    });

    const hasNextPage = skip + productos.length < total;

    return c.json({ productos, hasNextPage });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener productos" }, 500);
  }
});
newRouterCategories.put("/update/:categoryId", async (c) => {
  const { categoryId } = c.req.param();
  const prisma = await prismaClients.fetch(c.env.DB);
  const body = await c.req.json();

  // Validar que el body tenga al menos un campo válido para actualizar
  const allowedFields = [
    "seoTitle",
    "img",
    "imagenPrefijo",
    "title",
    "position",
  ];
  const updateData: Record<string, any> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return c.json(
      { error: "No se proporcionaron campos válidos para actualizar" },
      400
    );
  }

  try {
    const updatedCategory = await prisma.categoria.update({
      where: { categoryId },
      data: updateData,
    });

    return c.json({
      message: "Categoría actualizada correctamente",
      category: updatedCategory,
    });
  } catch (error) {
    // Manejar error si no existe categoría con ese categoryId
    console.error(error);

    if (
      error instanceof Error &&
      error.message.includes("Record to update not found")
    ) {
      return c.json({ error: "Categoría no encontrada" }, 404);
    }

    return c.json({ error: "Error al actualizar la categoría" }, 500);
  }
});

export default newRouterCategories;
