/**
 * LINE Webhook（純 Apps Script 版本）
 * 設定 LINE_CHANNEL_ACCESS_TOKEN、LINE_WEBHOOK_TOKEN（至少32位隨機字元）。
 * LINE Webhook URL：Apps Script部署網址?hookToken=你的LINE_WEBHOOK_TOKEN
 * 注意：Apps Script doPost(e) 不提供 X-Line-Signature Header，故無法執行LINE官方HMAC簽章驗證。
 * URL Token、事件去重及訂單綁定是額外防護，不等同官方簽章驗證。
 */
function doPost(e) {
  try {
    const expected = PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_TOKEN');
    const received = e && e.parameter ? String(e.parameter.hookToken || '') : '';
    if (!expected || !constantTimeEquals_(received, expected)) {
      console.warn('LINE Webhook token 驗證失敗');
      return ContentService.createTextOutput('Unauthorized');
    }
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    (body.events || []).forEach(function (ev) {
      try {
        if (isDuplicateLineEvent_(ev)) return;
        handleLineEvent_(ev);
      } catch (eventError) {
        console.error('LINE event error: ' + eventError);
      }
    });
  } catch (err) {
    console.error('LINE Webhook error: ' + err);
  }
  return ContentService.createTextOutput('OK');
}
function constantTimeEquals_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function isDuplicateLineEvent_(ev) {
  const id = ev && ev.webhookEventId;
  if (!id) return false;
  const cache = CacheService.getScriptCache();
  const key = 'LINE_EVT_' + String(id);
  if (cache.get(key)) return true;
  cache.put(key, '1', 21600);
  return false;
}
function handleLineEvent_(ev) {
  if (!ev || !ev.source || !ev.source.userId) return;
  const uid = ev.source.userId;
  if (ev.type === 'follow') {
    lineReply_(ev.replyToken, '歡迎加入露營區官方LINE！如要綁定訂單，請輸入：\n綁定 訂單編號 六位綁定碼\n綁定後即可接收訂位及付款通知。');
    return;
  }
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
  const msg = String(ev.message.text || '').trim();
  if (msg === '查詢訂單' || msg === '我的訂單') {
    const mine = rows_('Bookings').filter(function (b) {
      return String(b['LINE User ID'] || '') === uid && !['逾期取消', '已取消'].includes(String(b['狀態'] || ''));
    }).slice(-5);
    if (!mine.length) {
      lineReply_(ev.replyToken, '目前沒有查到已綁定的訂單。請先輸入「綁定 訂單編號 六位綁定碼」。');
      return;
    }
    const result = mine.map(function (b) {
      return '訂單：' + b['訂單編號'] + '\n狀態：' + b['狀態'] + '\n入住：' + dateKey_(b['入住日']) + '\n退營：' + dateKey_(b['退營日']) + '\n金額：NT$' + b['總金額'];
    }).join('\n\n');
    lineReply_(ev.replyToken, result);
    return;
  }
  const match = msg.match(/^綁定\s+(\S+)\s+(\d{6})$/);
  if (!match) {
    lineReply_(ev.replyToken, '可使用以下指令：\n1. 綁定 訂單編號 六位綁定碼\n2. 查詢訂單');
    return;
  }
  const booking = rows_('Bookings').find(function (b) {
    return String(b['訂單編號']) === match[1] && String(b['LINE綁定碼']) === match[2];
  });
  if (!booking) {
    lineReply_(ev.replyToken, '訂單編號或綁定碼錯誤，請確認訂位Email中的資料。');
    return;
  }
  patch_('Bookings', '訂單編號', match[1], {'LINE User ID': uid, 'LINE綁定碼': '', '最後更新': new Date()});
  lineReply_(ev.replyToken, 'LINE通知綁定成功！之後可輸入「查詢訂單」查看訂單狀態。');
}
function lineReply_(replyToken, message) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !replyToken) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + token},
    payload: JSON.stringify({replyToken: replyToken, messages: [{type: 'text', text: String(message).slice(0, 4900)}]}),
    muteHttpExceptions: true
  });
}
