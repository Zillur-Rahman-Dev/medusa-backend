import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const rawChatIds = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !rawChatIds) {
    logger.warn(
      "[Telegram Bot] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in environment variables. Telegram alert skipped."
    )
    return
  }

  const chatIds = rawChatIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  try {
    const orderModuleService = container.resolve(Modules.ORDER)
    const order = await orderModuleService.retrieveOrder(data.id, {
      relations: ["items", "shipping_address", "summary"],
    })

    if (!order) {
      logger.warn(`[Telegram Bot] Order with ID ${data.id} not found.`)
      return
    }

    const rawOrder = order as any

    const customerName =
      [rawOrder.shipping_address?.first_name, rawOrder.shipping_address?.last_name]
        .filter(Boolean)
        .join(" ") || "সম্মানিত ক্রেতা"

    const rawPhone = rawOrder.shipping_address?.phone || ""
    const phone = rawPhone || "ফোন নম্বর দেওয়া হয়নি"

    const address =
      [
        rawOrder.shipping_address?.address_1,
        rawOrder.shipping_address?.city,
        rawOrder.shipping_address?.province,
      ]
        .filter(Boolean)
        .join(", ") || "ঠিকানা পাওয়া যায়নি"

    const total =
      rawOrder.summary?.total ??
      rawOrder.summary?.accounting_total ??
      rawOrder.total ??
      0

    const currency = (rawOrder.currency_code || "BDT").toUpperCase()

    const itemsList =
      rawOrder.items && rawOrder.items.length > 0
        ? rawOrder.items
            .map(
              (item: any, i: number) =>
                `${i + 1}. 🍯 <b>${item.title || item.product_title || "মধু"}</b> × ${item.quantity} (${item.unit_price} ৳)`
            )
            .join("\n")
        : "কোনো পণ্য পাওয়া যায়নি"

    const displayOrderId = rawOrder.id ? rawOrder.id.slice(-6) : "NEW"

    // Format phone number for WhatsApp direct link (Bangladesh 880 format)
    let cleanPhone = rawPhone.replace(/[^0-9]/g, "")
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "88" + cleanPhone
    } else if (cleanPhone.length === 10) {
      cleanPhone = "880" + cleanPhone
    }

    const prefilledWhatsAppMsg = encodeURIComponent(
      `আসসালামু আলাইকুম ${customerName} ভাই, Pure Honey শপ থেকে আপনার অর্ডার #${displayOrderId} আমরা পেয়েছি।\nআপনার দেওয়া ঠিকানা: ${address}।\nঅর্ডারটি কনফার্ম করার জন্য অনুগ্রহ করে একটু জানাবেন। ধন্যবাদ!`
    )

    const whatsappUrl = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${prefilledWhatsAppMsg}`
      : ""

    const message = `
🔔 <b>নতুন মধু অর্ডার এসেছে!</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>অর্ডার আইডি:</b> #${displayOrderId}
👤 <b>ক্রেতার নাম:</b> ${customerName}
📞 <b>মোবাইল:</b> <a href="tel:${phone}">${phone}</a>
📍 <b>ঠিকানা:</b> ${address}

📦 <b>পণ্যের বিবরণ:</b>
${itemsList}

💰 <b>মোট বিল:</b> <b>৳${total}</b> (${currency})
🚚 <b>পেমেন্ট মোড:</b> ক্যাশ অন ডেলিভারি (COD)
⏰ <b>সময়:</b> ${new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" })}
━━━━━━━━━━━━━━━━━━━━
<i>💡 নিচের বাটনে চাপ দিয়ে সরাসরি WhatsApp করুন অথবা অর্ডার কনফার্ম করুন:</i>
`.trim()

    // Inline Keyboard Buttons
    const inlineKeyboard: any[][] = []

    // Row 1: WhatsApp Button
    if (whatsappUrl) {
      inlineKeyboard.push([
        {
          text: "💬 WhatsApp কাস্টমার",
          url: whatsappUrl,
        },
      ])
    }

    // Row 2: One-tap Order Status Management Buttons
    inlineKeyboard.push([
      {
        text: "✅ কনফার্ম করুন",
        callback_data: `confirm_${rawOrder.id}`,
      },
      {
        text: "❌ অর্ডার বাতিল",
        callback_data: `cancel_${rawOrder.id}`,
      },
    ])

    // Send alert to all configured recipients
    for (const cid of chatIds) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chat_id: cid,
              text: message,
              parse_mode: "HTML",
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: inlineKeyboard,
              },
            }),
          }
        )

        const result = await res.json()
        if (result.ok) {
          logger.info(
            `[Telegram Bot] Order alert successfully sent for #${rawOrder.id} to chat ${cid}`
          )
        } else {
          logger.error(
            `[Telegram Bot] Failed to send Telegram alert to ${cid}: ${JSON.stringify(result)}`
          )
        }
      } catch (err) {
        logger.error(`[Telegram Bot] Network error sending to ${cid}:`, err)
      }
    }
  } catch (error) {
    logger.error(`[Telegram Bot] Error processing order.placed event:`, error)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
