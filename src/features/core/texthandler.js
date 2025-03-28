const { userSessions, SessionState } = require('../core/session');
const { handleIpInput, handleSubdomainForSet } = require('../../features/setdns/handlers');
const { handleSubdomainForDDNS, handleIntervalForDDNS } = require('../../features/ddns/handlers');
const { handleSubdomainForDelete } = require('../../features/deldns/handlers');
const { handleDnsUpdateIpInput, handleSubdomainInput } = require('../../features/getdns/handlers');

function setupTextHandler(bot) {
  bot.on('text', async (ctx) => {
    console.log('收到文本消息:', ctx.message.text);
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session) {
      console.log('未找到会话，忽略消息');
      return;
    }

    session.lastUpdate = Date.now();

    // 统一的状态路由
    switch (session.state) {
      // setdns/deldns 相关状态
      case SessionState.WAITING_IP:
        await handleIpInput(ctx, session);
        break;
      case SessionState.WAITING_SUBDOMAIN_FOR_SET:
        await handleSubdomainForSet(ctx, session);
        break;

      // deldns 相关状态
      case SessionState.WAITING_SUBDOMAIN_FOR_DELETE:
        await handleSubdomainForDelete(ctx, session);
        break;

      // getdns/getdnsall 相关状态 
      case SessionState.WAITING_DNS_UPDATE_NEW_IP:
        await handleDnsUpdateIpInput(ctx, session);
        break;

      case SessionState.WAITING_SUBDOMAIN_INPUT:
        await handleSubdomainInput(ctx, session);
        break;

      // ddns 相关状态
      case SessionState.WAITING_SUBDOMAIN_FOR_DDNS:
        await handleSubdomainForDDNS(ctx, session);
        break;
      case SessionState.WAITING_INTERVAL_FOR_DDNS:
        await handleIntervalForDDNS(ctx, session);
        break;

      default:
        console.log(`未知会话状态: ${session.state}`);
    }
  });
}

module.exports = { setupTextHandler };
