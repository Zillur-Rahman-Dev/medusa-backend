import { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function dailySalesSummaryJob(container: MedusaContainer) {
  const logger = container.resolve("logger")
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const rawChatIds = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !rawChatIds) {
    logger.warn(
      "[Daily Sales Report] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured. Job skipped."
    )
    return
  }

  const chatIds = rawChatIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  try {
    const orderModuleService = container.resolve(Modules.ORDER)

    // Compute start of day in Bangladesh Time (UTC+6)
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
        take: 500,
      }
    )

    let totalRevenue = 0
    let confirmedCount = 0
    let cancelledCount = 0
    let pendingCount = 0
    const itemsCountMap: Record<string, number> = {}

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

        // Count items sold
        if (raw.items && Array.isArray(raw.items)) {
          for (const item of raw.items) {
            const title = item.title || item.product_title || "মধু"
            const qty = item.quantity || 1
            itemsCountMap[title] = (itemsCountMap[title] || 0) + qty
          }
        }
      }
    }

    const itemsSummary =
      Object.keys(itemsCountMap).length > 0
        ? Object.entries(itemsCountMap)
            .map(([title, qty]) => `  • 🍯 <b>${title}</b>: ${qty} টি`)
            .join("\n")
        : "  • আজ কোনো পণ্য বিক্রি হয়নি"

    const dateDisplay = bstNow.toLocaleDateString("bn-BD", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })

    const reportMessage = `
🌙 <b>Pure Honey - দৈনিক বিক্রির সমাপনী রিপোর্ট</b>
📅 <b>তারিখ:</b> ${dateDisplay}
━━━━━━━━━━━━━━━━━━━━
📦 <b>মোট অর্ডার:</b> <b>${orders.length} টি</b>
💰 <b>মোট বিক্রয়:</b> <b>৳${totalRevenue.toLocaleString("bn-BD")}</b>

🍯 <b>আজকের বিক্রিত পণ্যের হিসাব:</b>
${itemsSummary}

📈 <b>অর্ডারের সার্বিক অবস্থা:</b>
• ✅ কনফার্মড অর্ডার: <b>${confirmedCount}</b>
• ⏳ পেন্ডিং অর্ডার: <b>${pendingCount}</b>
• ❌ বাতিল অর্ডার: <b>${cancelledCount}</b>
━━━━━━━━━━━━━━━━━━━━
<i>আলহামদুলিল্লাহ! আজকের দিনের কার্যক্রম এখানেই সমাপ্ত। শুভ রাত্রি! 🌟</i>
`.trim()

    // Send summary to all chats/groups
    for (const cid of chatIds) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: cid,
            text: reportMessage,
            parse_mode: "HTML",
          }),
        })

        const resData = await res.json()
        if (resData.ok) {
          logger.info(`[Daily Sales Report] Report successfully sent to chat ${cid}`)
        } else {
          logger.error(
            `[Daily Sales Report] Telegram API error for ${cid}: ${JSON.stringify(resData)}`
          )
        }
      } catch (sendErr) {
        logger.error(`[Daily Sales Report] Network error sending to ${cid}:`, sendErr)
      }
    }
  } catch (error) {
    logger.error("[Daily Sales Report] Error generating daily sales report:", error)
  }
}

export const config = {
  name: "daily-sales-report",
  schedule: "59 17 * * *", // 17:59 UTC = 23:59 BST (Bangladesh Standard Time GMT+6)
}
