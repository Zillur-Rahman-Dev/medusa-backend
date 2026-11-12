import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/core-flows"

interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
}

interface TelegramChat {
  id: number
  type: string
  title?: string
}

interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: {
    message_id: number
    chat: TelegramChat
    text?: string
    reply_markup?: {
      inline_keyboard: any[][]
    }
  }
  data?: string
}

interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  date: number
  text?: string
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

// Helper to call Telegram Bot API
async function callTelegram(botToken: string, method: string, payload: Record<string, any>) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    return await res.json()
  } catch (err) {
    console.error(`[Telegram Webhook] Error calling Telegram API method ${method}:`, err)
    return { ok: false, error: err }
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({
    status: "ok",
    service: "Pure Honey Telegram Bot Webhook",
    timestamp: new Date().toISOString(),
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const rawChatIds = process.env.TELEGRAM_CHAT_ID

  if (!botToken) {
    res.status(500).json({ error: "TELEGRAM_BOT_TOKEN not configured" })
    return
  }

  const allowedChatIds = (rawChatIds || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  const body = req.body as TelegramUpdate

  // 1. Handle Inline Button Clicks (Callback Query)
  if (body?.callback_query) {
    const cb = body.callback_query
    const cbId = cb.id
    const data = cb.data || ""
    const chatId = cb.message?.chat.id
    const messageId = cb.message?.message_id
    const currentText = cb.message?.text || ""

    // Quick acknowledgement to stop the loading spinner in Telegram
    await callTelegram(botToken, "answerCallbackQuery", {
      callback_query_id: cbId,
      text: "প্রসেসিং হচ্ছে...",
    })

    const orderModuleService = req.scope.resolve(Modules.ORDER)

    // Handle Order Confirmation: confirm_<order_id>
    if (data.startsWith("confirm_") && chatId && messageId) {
      const orderId = data.replace("confirm_", "")
      const nowStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" })

      try {
        // Record confirmation in order metadata
        await orderModuleService.updateOrders(orderId, {
          metadata: {
            admin_status: "confirmed",
            confirmed_via: "telegram",
            confirmed_by: cb.from?.first_name || "Admin",
            confirmed_at: nowStr,
          },
        })

        // Keep WhatsApp button if available in previous keyboard, remove status action buttons
        const previousKeyboard = cb.message?.reply_markup?.inline_keyboard || []
        const retainedKeyboard = previousKeyboard.filter((row) =>
          row.some((btn) => btn.url && btn.url.includes("wa.me"))
        )

        const updatedText = `${currentText}\n\n✅ <b>অর্ডারটি টেলিগ্রাম থেকে কনফার্ম করা হয়েছে!</b>\n👤 কনফার্ম করেছেন: ${cb.from?.first_name || "Admin"}\n⏰ সময়: ${nowStr}`

        await callTelegram(botToken, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: updatedText,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: retainedKeyboard,
          },
        })
      } catch (err: any) {
        console.error(`[Telegram Webhook] Failed to confirm order ${orderId}:`, err)
        await callTelegram(botToken, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ অর্ডার #${orderId.slice(-6)} কনফার্ম করার সময় সমস্যা হয়েছে: ${err?.message || "Unknown error"}`,
        })
      }
    }

    // Handle Order Cancellation: cancel_<order_id>
    else if (data.startsWith("cancel_") && chatId && messageId) {
      const orderId = data.replace("cancel_", "")
      const nowStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" })

      try {
        // Attempt official Medusa cancelOrderWorkflow
        try {
          await cancelOrderWorkflow(req.scope).run({
            input: {
              order_id: orderId,
            },
          })
        } catch (wfErr) {
          console.warn("[Telegram Webhook] cancelOrderWorkflow fallback:", wfErr)
          // Fallback to metadata flag if workflow requirements (e.g. fulfillments) prevent hard cancel
          await orderModuleService.updateOrders(orderId, {
            metadata: {
              admin_status: "cancelled",
              cancelled_via: "telegram",
              cancelled_by: cb.from?.first_name || "Admin",
              cancelled_at: nowStr,
            },
          })
        }

        const updatedText = `${currentText}\n\n❌ <b>অর্ডারটি বাতিল (Cancelled) করা হয়েছে!</b>\n👤 বাতিল করেছেন: ${cb.from?.first_name || "Admin"}\n⏰ সময়: ${nowStr}`

        await callTelegram(botToken, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: updatedText,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [], // Remove all buttons
          },
        })
      } catch (err: any) {
        console.error(`[Telegram Webhook] Failed to cancel order ${orderId}:`, err)
        await callTelegram(botToken, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ অর্ডার #${orderId.slice(-6)} বাতিল করার সময় সমস্যা হয়েছে: ${err?.message || "Unknown error"}`,
        })
      }
    }

    res.json({ ok: true })
    return
  }

  // 2. Handle Interactive Commands (/today, /stock, /pending, /help, /start)
  if (body?.message && body.message.text) {
    const msg = body.message
    const text = (msg.text || "").trim().toLowerCase()
    const chatId = msg.chat.id
    const command = text.split(" ")[0].split("@")[0] // Handle /command@botname format

    // Security check: Only respond if the chat is authorized (if TELEGRAM_CHAT_ID is set)
    if (allowedChatIds.length > 0 && !allowedChatIds.includes(String(chatId))) {
      await callTelegram(botToken, "sendMessage", {
        chat_id: chatId,
        text: `🔒 <b>অননুমোদিত অ্যাক্সেস!</b>\nআপনার Chat ID: <code>${chatId}</code>\nএই বটটি শুধুমাত্র Pure Honey অ্যাডমিনদের জন্য নির্দিষ্ট। এই Chat ID টি অ্যাডমিন প্যানেল এনভায়রনমেন্টে যুক্ত করুন।`,
        parse_mode: "HTML",
      })
      res.json({ ok: true })
      return
    }

    const orderModuleService = req.scope.resolve(Modules.ORDER)
    const productModuleService = req.scope.resolve(Modules.PRODUCT)

    // Command: /start or /help
    if (command === "/start" || command === "/help") {
      const helpMsg = `
👋 <b>Pure Honey অ্যাডমিন বটে আপনাকে স্বাগতম!</b>
━━━━━━━━━━━━━━━━━━━━
দোকানের রিয়েলটাইম হিসাব ও তথ্য জানতে নিচের কমান্ডগুলো ব্যবহার করুন:

📊 <b>/today</b> - আজকের মোট অর্ডার ও বিক্রয় সারাংশ
🍯 <b>/stock</b> - মধুর বর্তমান স্টক ও ইনভেন্টরি
⏳ <b>/pending</b> - পেন্ডিং অর্ডারের তালিকা
❓ <b>/help</b> - কমান্ড সহায়িকা

<i>💡 নতুন যেকোনো অর্ডার আসলে অটোমেটিক ১-ক্লিক WhatsApp ও কনফার্ম বাটন সহ নোটিফিকেশন আসবে।</i>
`.trim()

      await callTelegram(botToken, "sendMessage", {
        chat_id: chatId,
        text: helpMsg,
        parse_mode: "HTML",
      })
    }

    // Command: /today - Daily sales and orders
    else if (command === "/today") {
      try {
        // Compute start of today in Bangladesh Time (UTC+6)
        const now = new Date()
        const bstOffset = 6 * 60 * 60 * 1000
        const bstNow = new Date(now.getTime() + bstOffset)
        const bstStartOfDay = new Date(
          Date.UTC(bstNow.getUTCFullYear(), bstNow.getUTCMonth(), bstNow.getUTCDate(), 0, 0, 0)
        )
        const utcStartOfDay = new Date(bstStartOfDay.getTime() - bstOffset)

        const orders = await orderModuleService.listOrders(
          {
            created_at: {
              $gte: utcStartOfDay.toISOString(),
            },
          },
          {
            relations: ["items", "summary"],
            take: 100,
          }
        )

        let totalRevenue = 0
        let confirmedCount = 0
        let cancelledCount = 0
        let pendingCount = 0

        for (const ord of orders) {
          const raw = ord as any
          const ordTotal =
            raw.summary?.total ?? raw.summary?.accounting_total ?? raw.total ?? 0
          const metaStatus = raw.metadata?.admin_status

          if (raw.status === "canceled" || metaStatus === "cancelled") {
            cancelledCount++
          } else {
            totalRevenue += Number(ordTotal) || 0
            if (metaStatus === "confirmed") {
              confirmedCount++
            } else {
              pendingCount++
            }
          }
        }

        const dateDisplay = bstNow.toLocaleDateString("bn-BD", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })

        const todayReport = `
📊 <b>আজকের বিক্রির সারাংশ (${dateDisplay})</b>
━━━━━━━━━━━━━━━━━━━━
📦 মোট অর্ডার: <b>${orders.length} টি</b>
💰 মোট বিক্রয়: <b>৳${totalRevenue.toLocaleString("bn-BD")}</b>

📈 <b>অর্ডারের অবস্থা:</b>
• ✅ কনফার্মড: <b>${confirmedCount}</b>
• ⏳ পেন্ডিং: <b>${pendingCount}</b>
• ❌ বাতিল: <b>${cancelledCount}</b>
━━━━━━━━━━━━━━━━━━━━
<i>রিয়েলটাইম আপডেট পেতে /pending চাপুন</i>
`.trim()

        await callTelegram(botToken, "sendMessage", {
          chat_id: chatId,
          text: todayReport,
          parse_mode: "HTML",
        })
      } catch (err: any) {
        console.error("[Telegram Webhook] /today error:", err)
        await callTelegram(botToken, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ তথ্য লোড করতে সমস্যা হয়েছে: ${err?.message || "Unknown error"}`,
        })
      }
    }

    // Command: /stock - Product stock and inventory
    else if (command === "/stock") {
      try {
        const products = await productModuleService.listProducts(
          {},
          {
            relations: ["variants"],
            take: 50,
          }
        )

        // Filter for honey products (exclude sample clothes)
        const honeyProducts = products.filter(
          (p: any) =>
            !p.title.toLowerCase().includes("shirt") &&
            !p.title.toLowerCase().includes("pants") &&
            !p.title.toLowerCase().includes("hoodie")
        )

        const productLines = honeyProducts.map((p: any) => {
          const variantsStr = (p.variants || [])
            .map((v: any) => `  • ${v.title}: ${v.inventory_quantity ?? "উপলব্ধ"}`)
            .join("\n")
          return `🍯 <b>${p.title}</b>\n${variantsStr || "  • স্টক উপলব্ধ"}`
        })

        const stockReport = `
📦 <b>মধুর ইনভেন্টরি ও স্টক রিপোর্ট</b>
━━━━━━━━━━━━━━━━━━━━
${productLines.join("\n\n") || "কোনো মধু প্রোডাক্ট পাওয়া যায়নি"}
━━━━━━━━━━━━━━━━━━━━
<i>স্টক আপডেট করতে এডমিন ড্যাশবোর্ড ভিজিট করুন।</i>
`.trim()

        await callTelegram(botToken, "sendMessage", {
          chat_id: chatId,
          text: stockReport,
          parse_mode: "HTML",
        })
      } catch (err: any) {
        console.error("[Telegram Webhook] /stock error:", err)
        await callTelegram(botToken, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ স্টক লোড করতে সমস্যা হয়েছে: ${err?.message || "Unknown error"}`,
        })
      }
    }

    // Command: /pending - Orders waiting for confirmation
    else if (command === "/pending") {
      try {
        const orders = await orderModuleService.listOrders(
          {},
          {
            relations: ["shipping_address", "summary", "items"],
            take: 50,
          }
        )

        // Filter out those marked cancelled or confirmed in metadata or order status
        const activePending = orders.filter(
          (o: any) =>
            o.status !== "canceled" &&
            o.status !== "completed" &&
            o.metadata?.admin_status !== "cancelled" &&
            o.metadata?.admin_status !== "confirmed"
        )

        if (activePending.length === 0) {
          await callTelegram(botToken, "sendMessage", {
            chat_id: chatId,
            text: "🎉 <b>আলহামদুলিল্লাহ! বর্তমানে কোনো পেন্ডিং অর্ডার নেই।</b>\nসব অর্ডার প্রসেস সম্পন্ন হয়েছে।",
            parse_mode: "HTML",
          })
        } else {
          const listStr = activePending
            .map((o: any, idx: number) => {
              const name = [o.shipping_address?.first_name, o.shipping_address?.last_name]
                .filter(Boolean)
                .join(" ") || "সম্মানিত ক্রেতা"
              const phone = o.shipping_address?.phone || "ফোন নেই"
              const total = o.summary?.total ?? o.total ?? 0
              const shortId = o.id.slice(-6)
              return `${idx + 1}. <b>#${shortId}</b> - ${name}\n   📞 ${phone} | 💰 ৳${total}`
            })
            .join("\n\n")

          const pendingMsg = `
⏳ <b>পেন্ডিং অর্ডারের তালিকা (${activePending.length} টি)</b>
━━━━━━━━━━━━━━━━━━━━
${listStr}
━━━━━━━━━━━━━━━━━━━━
<i>💡 অর্ডার কনফার্ম করতে পূর্বের নোটিফিকেশনের বাটনে চাপ দিন।</i>
`.trim()

          await callTelegram(botToken, "sendMessage", {
            chat_id: chatId,
            text: pendingMsg,
            parse_mode: "HTML",
          })
        }
      } catch (err: any) {
        console.error("[Telegram Webhook] /pending error:", err)
        await callTelegram(botToken, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ পেন্ডিং তালিকা লোড করতে সমস্যা হয়েছে: ${err?.message || "Unknown error"}`,
        })
      }
    }

    // Default response for unhandled text
    else {
      await callTelegram(botToken, "sendMessage", {
        chat_id: chatId,
        text: `🤖 কমান্ডটি বুঝতে পারছি না।\nউপলব্ধ কমান্ডগুলো দেখতে <b>/help</b> চাপুন।`,
        parse_mode: "HTML",
      })
    }
  }

  res.json({ ok: true })
}
