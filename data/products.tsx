import { Hono } from "hono";
import { Bindings } from "../types/types";
import prismaClients from "../src/lib/prismaClients";
import { Producto } from "../types/Product";

const newRouterProducts = new Hono<{ Bindings: Bindings }>();

newRouterProducts.post("/create", async (c) => {
  const body: Producto[] = await c.req.json();
  const prisma = await prismaClients.fetch(c.env.DB);

  try {
    for (const producto of body) {
      // const categoriaExistente = await prisma.categoria.findUnique({
      //   where: { categoryId: producto.categoryId },
      // });
      const categoriaExistente = await prisma.categoria.findUnique({
        where: { categoryId: producto.categoryId },
      });
      console.log(categoriaExistente);
      if (!categoriaExistente) {
        return c.json(
          { error: `La categoría ${producto.categoryId} no existe` },
          400
        );
      }

      await prisma.producto.create({
        data: {
          title: producto.title,
          categoryId: categoriaExistente.id,
          identificador: producto.identificador,
          description: producto.description,
          price: producto.variants[0].price,
          createdAt: new Date(),
          docena: producto.docena,
          cantidad: producto.cantidad,
          productId: producto.productId || null,
          inStock: producto.inStock !== undefined ? producto.inStock : true,
          isPrivate: producto.isPrivate !== undefined ? producto.isPrivate : false,
          topicTags: {
            create: producto.topicTags?.map((tag) => ({ tag: tag.tag })) || [],
          },
          variants: {
            create: producto.variants.map((variant) => ({
              description: variant.description,
              price: variant.price,
              priceWithoutOff: variant.priceWithoutOff,
              precioDocena: variant.precioDocena,
              sizes_x: variant.sizes_x,
              sizes_y: variant.sizes_y,
              sizes_z: variant.sizes_z,
              images: {
                create: variant.images.map((img) => ({
                  src: img.src,
                  isVideo: img.isVideo,
                  needContrast: img.needContrast,
                })),
              },
              colors: {
                create:
                  variant.colors?.map((c) => ({
                    name: c.name,
                    color: c.color,
                  })) || [],
              },
            })),
          },
        },
      });
    }

    return c.json({ message: "Productos creados correctamente" }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Error al crear productos" }, 500);
  }
});
////////////////////////
newRouterProducts.get("/recomendados", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  // Query params
  const sortByUpdate = c.req.query("sortByUpdate"); // "asc" | "desc"
  const sortByCreated = c.req.query("sortByCreated"); // "asc" | "desc"
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "5");

  const skip = (page - 1) * limit;

  // Armado dinámico del ordenamiento
  const orderBy: any[] = [];

  if (sortByUpdate === "asc" || sortByUpdate === "desc") {
    orderBy.push({ updatedAt: sortByUpdate });
  }

  if (sortByCreated === "asc" || sortByCreated === "desc") {
    orderBy.push({ createdAt: sortByCreated });
  }

  try {
    const productos = await prisma.producto.findMany({
      where: {
        topicTags: {
          some: {
            tag: { in: ["recomendado", "recommended"] },
          },
        },
      },
      skip,
      take: limit,
      orderBy: orderBy.length > 0 ? orderBy : undefined,
      include: {
        topicTags: true,
        variants: {
          select: {
            price: true,
            priceWithoutOff: true,
            images: {
              take: 2,
              select: { src: true },
            },
          },
        },
      },
    });

    const total = await prisma.producto.count({
      where: {
        topicTags: {
          some: {
            tag: { in: ["recomendado", "recommended"] },
          },
        },
      },
    });

    const hasNextPage = skip + productos.length < total;

    return c.json({ productos, hasNextPage });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener productos recomendados" }, 500);
  }
});

newRouterProducts.post("/similares", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  const limitCategories = parseInt(c.req.query("limitCategories") || "4");
  const limitTags = parseInt(c.req.query("limitTags") || "4");

  try {
    // Obtener el producto del body
    const body = await c.req.json();
    const producto = body.producto || body;

    if (!producto || !producto.id || !producto.categoryId) {
      return c.json(
        {
          error:
            "Producto inválido o faltan campos requeridos (id, categoryId)",
        },
        400
      );
    }

    // Extraer los tags del producto
    const tags = producto.topicTags?.map((t: any) => t.tag) || [];

    console.log("Producto recibido:", producto.id);
    console.log("CategoryId:", producto.categoryId);
    console.log("Tags:", tags);

    // 1. Productos de la misma categoría (excluyendo el producto actual)
    const productosCategoria = await prisma.producto.findMany({
      where: {
        categoryId: producto.categoryId,
        id: { not: producto.id },
      },
      include: {
        topicTags: true,
        variants: {
          select: {
            price: true,
            priceWithoutOff: true,
            images: {
              take: 2,
              select: { src: true },
            },
          },
        },
      },
    });

    console.log(
      "Productos por categoría encontrados:",
      productosCategoria.length
    );

    // 2. Productos con tags similares (excluyendo el producto actual y los de la categoría)
    const idsCategoria = productosCategoria.map((p) => p.id);

    let productosTags: any[] = [];
    if (tags.length > 0) {
      productosTags = await prisma.producto.findMany({
        where: {
          topicTags: {
            some: {
              tag: { in: tags },
            },
          },
          id: {
            not: producto.id,
            notIn: idsCategoria, // Excluir productos ya incluidos en fromCategories
          },
        },
        include: {
          topicTags: true,
          variants: {
            select: {
              price: true,
              priceWithoutOff: true,
              images: {
                take: 2,
                select: { src: true },
              },
            },
          },
        },
      });
    }

    console.log("Productos por tags encontrados:", productosTags.length);

    // Función para aleatorizar y limitar
    const shuffleAndLimit = (arr: any[], limit: number) => {
      const shuffled = arr.sort(() => Math.random() - 0.5);
      return shuffled.slice(0, limit);
    };

    return c.json({
      fromCategories: shuffleAndLimit(productosCategoria, limitCategories),
      fromTags: shuffleAndLimit(productosTags, limitTags),
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener productos similares" }, 500);
  }
});

newRouterProducts.get("/nuevos", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  // Query params
  const sortByUpdate = c.req.query("sortByUpdate"); // "asc" | "desc"
  const sortByCreated = c.req.query("sortByCreated"); // "asc" | "desc"
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "5");

  const skip = (page - 1) * limit;

  // Armado dinámico del ordenamiento
  const orderBy: any[] = [];

  if (sortByUpdate === "asc" || sortByUpdate === "desc") {
    orderBy.push({ updatedAt: sortByUpdate });
  }

  if (sortByCreated === "asc" || sortByCreated === "desc") {
    orderBy.push({ createdAt: sortByCreated });
  }

  try {
    const productos = await prisma.producto.findMany({
      where: {
        topicTags: {
          some: {
            tag: { in: ["nuevo", "new"] },
          },
        },
      },
      skip,
      take: limit,
      orderBy: orderBy.length > 0 ? orderBy : undefined,
      include: {
        topicTags: true,
        variants: {
          select: {
            price: true,
            priceWithoutOff: true,
            images: {
              take: 2,
              select: { src: true },
            },
          },
        },
      },
    });

    const total = await prisma.producto.count({
      where: {
        topicTags: {
          some: {
            tag: { in: ["nuevo", "new"] },
          },
        },
      },
    });

    const hasNextPage = skip + productos.length < total;

    return c.json({ productos, hasNextPage });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener productos nuevos" }, 500);
  }
});

newRouterProducts.get("/recientes", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  // Query params
  const sortByUpdate = c.req.query("sortByUpdate"); // "asc" | "desc"
  const sortByCreated = c.req.query("sortByCreated"); // "asc" | "desc"
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "5");

  const skip = (page - 1) * limit;

  // Armado dinámico del ordenamiento
  const orderBy: any[] = [];

  if (sortByUpdate === "asc" || sortByUpdate === "desc") {
    orderBy.push({ updatedAt: sortByUpdate });
  }

  if (sortByCreated === "asc" || sortByCreated === "desc") {
    orderBy.push({ createdAt: sortByCreated });
  }

  // Si no se especifica ordenamiento, ordenar por fecha de creación descendente por defecto
  if (orderBy.length === 0) {
    orderBy.push({ createdAt: "desc" });
  }

  try {
    const productos = await prisma.producto.findMany({
      skip,
      take: limit,
      orderBy,
      include: {
        topicTags: true,
        variants: {
          select: {
            price: true,
            priceWithoutOff: true,
            images: {
              take: 2,
              select: { src: true },
            },
          },
        },
      },
    });

    const total = await prisma.producto.count();

    const hasNextPage = skip + productos.length < total;

    return c.json({ productos, hasNextPage });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener productos recientes" }, 500);
  }
});

newRouterProducts.get("/preview", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  const page = Number(c.req.query("page") || "1");
  const limit = Number(c.req.query("limit") || "10");
  const all = c.req.query("all") === "true";
  const skip = (page - 1) * limit;

  const productos = await prisma.producto.findMany({
    skip: all ? undefined : skip,
    take: all ? undefined : limit,
    select: {
      id: true,
      title: true,
      description: all ? true : false,
      identificador: true,
      inStock: true,
      categoryId: true,
      variants: {
        take: all ? undefined : 1,
        select: {
          sizes_x: all ? true : false,
          sizes_y: all ? true : false,
          sizes_z: all ? true : false,
          colors: all ? true : false,
          price: true,
          priceWithoutOff: true,
          images: {
            skip: 1,
            take: all ? undefined : 1,
            select: {
              src: true,
            },
          },
        },
      },
    },
  });

  return c.json({
    page: all ? 1 : page,
    limit: all ? productos.length : limit,
    total: productos.length,
    productos,
  });
});
// newRouterProducts.get("/custom/:id", async (c) => {
//   const prisma = await prismaClients.fetch(c.env.DB);
//   const id = c.req.param("id");

//   const producto = await prisma.producto.findUnique({
//     where: { id },
//     include: {
//       topicTags: true,
//       variants: {
//         include: {
//           images: true,
//           colors: true,
//         },
//       },
//     },
//   });

//   if (!producto) {
//     return c.json({ error: "Producto no encontrado" }, 404);
//   }

//   return c.json({ producto });
// });

/**
 * GET /products/by-tag-and-category
 * Obtiene productos filtrados por tag y categoría con paginación
 */
newRouterProducts.get("/by-tag-and-category", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  const tag = c.req.query("tag");
  const categoryId = c.req.query("categoryId");
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "12");

  if (!tag) {
    return c.json({ error: "El parámetro 'tag' es requerido" }, 400);
  }

  if (!categoryId) {
    return c.json({ error: "El parámetro 'categoryId' es requerido" }, 400);
  }

  const skip = (page - 1) * limit;

  try {
    const productos = await prisma.producto.findMany({
      where: {
        categoryId: categoryId,
        topicTags: {
          some: {
            tag: tag,
          },
        },
      },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        topicTags: true,
        variants: {
          select: {
            price: true,
            priceWithoutOff: true,
            images: {
              take: 2,
              select: { src: true },
            },
          },
        },
      },
    });

    const totalProductos = await prisma.producto.count({
      where: {
        categoryId: categoryId,
        topicTags: {
          some: {
            tag: tag,
          },
        },
      },
    });

    const totalPages = Math.ceil(totalProductos / limit);

    return c.json({
      productos,
      pagination: {
        totalProductos,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener productos" }, 500);
  }
});

/**
 * GET /products/colecciones/:tag/categories
 * Obtiene las categorías que existen dentro de una colección (tag)
 */

newRouterProducts.get("/:categoryId", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const categoryId = c.req.param("categoryId");

  // Parámetros de paginación por query, con valores por defecto
  const page = parseInt(c.req.query("page") || "1");
  const pageSize = parseInt(c.req.query("pageSize") || "10");

  const skip = (page - 1) * pageSize;

  const productos = await prisma.producto.findMany({
    where: { categoryId },
    skip,
    take: pageSize,
    include: {
      variants: {
        take: 1,
        select: {
          price: true,
          priceWithoutOff: true,
          images: {
            take: 0,
            select: { src: true },
          },
        },
      },
      topicTags: true,
    },
  });

  // Total de productos para la paginación
  const total = await prisma.producto.count({
    where: { categoryId },
  });

  return c.json({
    productos,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
});

newRouterProducts.patch("/:id/price", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const id = c.req.param("id");
  const { price, priceNoOff } = await c.req.json();

  if (typeof price !== "number" && typeof priceNoOff !== "number") {
    return c.json({ error: "Precio inválido" }, 400);
  }

  try {
    const producto = await prisma.producto.findUnique({
      where: { id },
      include: {
        variants: {
          take: 1,
          select: { id: true },
        },
      },
    });

    if (!producto || producto.variants.length === 0) {
      return c.json({ error: "Producto o variante no encontrada" }, 404);
    }

    const variantId = producto.variants[0].id;

    await prisma.variants_producto.update({
      where: { id: variantId },
      data: { price, priceWithoutOff: priceNoOff },
    });

    return c.json({ message: "Precio actualizado correctamente" });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al actualizar el precio" }, 500);
  }
});

newRouterProducts.patch("/edit/:id", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const id = c.req.param("id");
  const body: Partial<Producto> = await c.req.json();

  try {
    const existing = await prisma.producto.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: "Producto no encontrado" }, 404);
    }

    // Si se proporciona categoryId, usarlo directamente (asumiendo que es el ID interno)
    const updateData: any = {
      title: body.title,
      description: body.description,
      updatedAt: new Date(),
      cantidad: body.cantidad,
      docena: body.docena,
      identificador: body.identificador,
      inStock: body.inStock,
      productId: body.productId,
      isPrivate: body.isPrivate,
      topicTags: {
        deleteMany: {},
        create:
          body.topicTags?.map((tag) => ({
            tag: tag.tag,
          })) || [],
      },
      variants: {
        deleteMany: {},
        create:
          body.variants?.map((variant) => ({
            description: variant.description,
            price: variant.price,
            priceWithoutOff: variant.priceWithoutOff,
            precioDocena: variant.precioDocena,
            sizes_x: variant.sizes_x,
            sizes_y: variant.sizes_y,
            sizes_z: variant.sizes_z,
            images: {
              create: variant.images.map((img) => ({
                src: img.src,
                isVideo: img.isVideo,
                needContrast: img.needContrast,
              })),
            },
            colors: {
              create:
                variant.colors?.map((c) => ({
                  name: c.name,
                  color: c.color,
                })) || [],
            },
          })) || [],
      },
    };

    // Agregar categoryId si se proporciona
    if (body.categoryId) {
      updateData.categoryId = body.categoryId;
    }

    const updated = await prisma.producto.update({
      where: { id },
      data: updateData,
    });

    return c.json({ message: "Producto actualizado", updated });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al actualizar producto" }, 500);
  }
});

newRouterProducts.get("/custom/:id", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const id = c.req.param("id");
  const skipVariant: number = Number(c.req.query("variantSkip")) ?? 0;
  // if (!skipVariant) return c.json({ error: "Error en parametro skip" }, 500);
  try {
    const producto = await prisma.producto.findUnique({
      where: { id },
      include: {
        topicTags: true,
        variants: {
          include: {
            images: {
              skip: skipVariant ?? 0,
            },
            colors: true,
          },
        },
      },
    });
    console.log("first");
    return c.json({ producto });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener el producto" }, 500);
  }
});
newRouterProducts.get("/custom/old/:id", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const id = c.req.param("id");
  const skipVariant: number = Number(c.req.query("variantSkip")) ?? 0;
  // if (!skipVariant) return c.json({ error: "Error en parametro skip" }, 500);
  try {
    const producto = await prisma.producto.findUnique({
      where: { identificador: id },
      include: {
        topicTags: true,
        variants: {
          include: {
            images: {
              skip: skipVariant ?? 0,
            },
          },
        },
      },
    });

    return c.json({ producto });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener el producto" }, 500);
  }
});
newRouterProducts.get("/all/names", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  try {
    const productos = await prisma.producto.findMany({
      select: {
        id: true,
        title: true,
        topicTags: true,
      },
    });

    return c.json({ productos }); // Devuelve un array con { id, title }
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al obtener los productos" }, 500);
  }
});
newRouterProducts.get("/all/length", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);

  try {
    const total = await prisma.producto.count();

    return c.json({ length: total }); // Devuelve algo como { length: 123 }
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al contar los productos" }, 500);
  }
});

newRouterProducts.delete("/:id", async (c) => {
  const prisma = await prismaClients.fetch(c.env.DB);
  const id = c.req.param("id");

  try {
    // Verificar si el producto existe
    const producto = await prisma.producto.findUnique({
      where: { id },
      include: {
        variants: {
          include: {
            images: true,
            colors: true,
          },
        },
        topicTags: true,
      },
    });

    if (!producto) {
      return c.json({ error: "Producto no encontrado" }, 404);
    }

    // Eliminar relaciones dependientes
    await prisma.topicTag.deleteMany({
      where: { productoId: id },
    });

    for (const variant of producto.variants) {
      await prisma.imagenes.deleteMany({
        where: { variantId: variant.id },
      });
      await prisma.imagenes.deleteMany({
        where: { variantId: variant.id },
      });
    }

    await prisma.variants_producto.deleteMany({
      where: { productoId: id },
    });

    // Eliminar el producto
    await prisma.producto.delete({
      where: { id },
    });

    return c.json({ message: "Producto eliminado correctamente" });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error al eliminar el producto" }, 500);
  }
});

export default newRouterProducts;
