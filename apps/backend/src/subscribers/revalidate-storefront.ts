import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function masterRevalidateHandler({
  event,
  container,
}: SubscriberArgs<any>) {
  const logger = container.resolve("logger")

  const storefrontUrl =
    process.env.STOREFRONT_URL || "https://medusa-storefront-drab-psi.vercel.app"
  const secret =
    process.env.REVALIDATE_SECRET || "purehoney_revalidate_secret_2026"

  try {
    const res = await fetch(`${storefrontUrl}/api/revalidate?secret=${secret}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: event.name,
        data: event.data,
      }),
    })

    if (res.ok) {
      logger.info(`[Auto-Sync] Storefront revalidation triggered for: ${event.name}`)
    } else {
      logger.warn(`[Auto-Sync] Storefront revalidation warning (status: ${res.status}) for ${event.name}`)
    }
  } catch (err: any) {
    logger.error(`[Auto-Sync] Storefront revalidation network warning: ${err?.message || err}`)
  }
}

export const config: SubscriberConfig = {
  event: [
    // 1. Products
    "product.created",
    "product.updated",
    "product.deleted",

    // 2. Product Variants (weights, sizes)
    "product-variant.created",
    "product-variant.updated",
    "product-variant.deleted",

    // 3. Pricing
    "price.created",
    "price.updated",
    "price.deleted",
    "price_list.created",
    "price_list.updated",
    "price_list.deleted",
    "price-set.updated",

    // 4. Inventory
    "inventory-item.created",
    "inventory-item.updated",
    "inventory-item.deleted",
    "inventory-level.created",
    "inventory-level.updated",
    "inventory-level.deleted",

    // 5. Categories
    "product_category.created",
    "product_category.updated",
    "product_category.deleted",

    // 6. Collections
    "product_collection.created",
    "product_collection.updated",
    "product_collection.deleted",

    // 7. Shipping Options (Delivery fees)
    "shipping_option.created",
    "shipping_option.updated",
    "shipping_option.deleted",

    // 8. Promotions
    "promotion.created",
    "promotion.updated",
    "promotion.deleted",
    "campaign.created",
    "campaign.updated",
    "campaign.deleted",
  ],
}
