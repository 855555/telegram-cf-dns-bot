const { userSessions, SessionState } = require('../utils/session');
const { createOrUpdateDns, deleteDnsRecord, getDnsRecord, updateDnsRecord, deleteSingleDnsRecord } = require('../services/cloudflare');
const { displayDnsRecordsPage, queryDomainRecords, setupDDNS } = require('./messages');
const { getZoneIdForDomain } = require('../utils/domain');
const { DNS_RECORDS_PAGE_SIZE } = require('../config');
const { helpMessage } = require('./commands');
const { stopDDNS, getAllDDNSTasks } = require('../services/ddns');

function setupCallbacks(bot) {
  // 处理帮助按钮回调
  bot.action('help_dns_management', (ctx) => {
    const dnsManagementHelp =
      '📝 <b>DNS 记录管理</b>\n' +
      '➖➖➖➖➖➖➖➖➖➖➖➖\n' +
      '✅ /setdns - 添加或更新 DNS 记录\n' +
      '   • 支持 IPv4 和 IPv6 地址\n' +
      '   • 可选择是否启用代理\n\n' +
      '🔍 /getdns - 查询 DNS 记录\n' +
      '   • 查看域名的详细配置\n\n' +
      '🔍 /getdnsall - 查询所有 DNS 记录\n' +
      '   • 查看根域名下所有记录\n\n' +
      '❌ /deldns - 删除 DNS 记录\n' +
      '   • 删除前会要求确认\n\n';

      ctx.editMessageText(dnsManagementHelp, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '« 返回', callback_data: 'help_back' }]]
        }
      });
  });

  // 处理DDNS管理帮助回调
  bot.action('help_ddns_management', async (ctx) => {
    const ddnsHelpMessage =
      '🔄 <b>DDNS动态域名管理</b>\n\n' +
      '动态DNS服务允许您自动更新域名指向的IP地址，特别适合家庭宽带等动态IP环境。\n\n' +
      '<b>可用命令：</b>\n' +
      '• /ddns - 设置新的DDNS任务\n' +
      '• /ddnsstatus - 查看所有DDNS任务状态\n' +
      '• /stopddns - 停止指定的DDNS任务\n\n' +
      '<b>DDNS功能亮点：</b>\n' +
      '• 自动检测IPv4和IPv6地址变化\n' +
      '• 支持多域名同时监控\n' +
      '• 可自定义更新频率（60秒-24小时）\n' +
      '• IP变更时自动推送通知\n' +
      '• 针对中国大陆优化的动态IP检测';

    await ctx.editMessageText(ddnsHelpMessage, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '« 返回', callback_data: 'help_back' }]]
      }
    });
  });

  bot.action('help_system_info', (ctx) => {
    const systemInfoHelp =
      '📊 <b>系统信息</b>\n' +
      '➖➖➖➖➖➖➖➖➖➖➖➖\n' +
      '🌐 /domains - 查看所有配置的域名\n' +
      '👤 /listusers - 查看白名单用户列表 (仅管理员)\n' +
      '🔧 /zonemap - 查看域名和 Zone ID 映射 (仅管理员)';

    ctx.editMessageText(systemInfoHelp, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '« 返回', callback_data: 'help_back' }]]
      }
    });
  });

  bot.action('help_general', (ctx) => {
    const generalHelp =
      '❓ <b>帮助信息</b>\n' +
      '➖➖➖➖➖➖➖➖➖➖➖➖\n' +
      '💡 提示：本机器人只对接CF官方api。添加、更新、删除操作都可以通过点击"取消"按钮随时终止。\n' +
      '🔄 使用 /start 命令可以重新显示主菜单。';

    ctx.editMessageText(generalHelp, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '« 返回', callback_data: 'help_back' }]]
      }
    });
  });

  bot.action('help_back', (ctx) => {
    const helpButtons = [
      [{ text: '📝 DNS记录管理', callback_data: 'help_dns_management' }],
      [{ text: '🔄 DDNS动态域名', callback_data: 'help_ddns_management' }],
      [{ text: '📊 系统信息', callback_data: 'help_system_info' }],
      [{ text: '❓ 帮助信息', callback_data: 'help_general' }]
    ];

    ctx.editMessageText(helpMessage, {
      reply_markup: {
        inline_keyboard: helpButtons
      }
    });
  });

  // 取消操作的回调
  bot.action('cancel_setdns', (ctx) => {
    const chatId = ctx.chat.id;
    userSessions.delete(chatId);
    ctx.editMessageText('已取消DNS记录设置操作。');
  });

  bot.action('cancel_getdns', async (ctx) => {
    const chatId = ctx.chat.id;
    userSessions.delete(chatId);
    await ctx.editMessageText('已取消DNS记录查询操作。');
  });

  bot.action('cancel_deldns', (ctx) => {
    const chatId = ctx.chat.id;
    userSessions.delete(chatId);
    ctx.editMessageText('已取消DNS记录删除操作。');
  });

  bot.action('cancel_delete', async (ctx) => {
    const chatId = ctx.chat.id;
    userSessions.delete(chatId);
    await ctx.editMessageText('已取消删除操作。');
  });

  // 代理设置的回调
  bot.action('proxy_yes', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_PROXY) {
      return;
    }

    await ctx.editMessageText(
      `正在处理: ${session.domain} -> ${session.ipAddress} ` +
      `(类型: ${session.recordType}, 已启用代理)`
    );

    try {
      const result = await createOrUpdateDns(
        session.domain,
        session.ipAddress,
        session.recordType,
        true
      );
      await ctx.reply(result.message);
    } catch (error) {
      await ctx.reply(`处理过程中发生错误: ${error.message}`);
    }

    userSessions.delete(chatId);
  });

  bot.action('proxy_no', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_PROXY) {
      return;
    }

    await ctx.editMessageText(
      `正在处理: ${session.domain} -> ${session.ipAddress} ` +
      `(类型: ${session.recordType}, 未启用代理)`
    );

    try {
      const result = await createOrUpdateDns(
        session.domain,
        session.ipAddress,
        session.recordType,
        false
      );
      await ctx.reply(result.message);
    } catch (error) {
      await ctx.reply(`处理过程中发生错误: ${error.message}`);
    }

    userSessions.delete(chatId);
  });

  // 确认删除的回调
  bot.action('confirm_delete', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_CONFIRM_DELETE) {
      return;
    }

    const domainName = session.domain;
    await ctx.editMessageText(`正在删除 ${domainName} 的DNS记录...`);

    try {
      const result = await deleteDnsRecord(domainName);
      await ctx.reply(result.message);
    } catch (error) {
      await ctx.reply(`删除过程中发生错误: ${error.message}`);
    }

    userSessions.delete(chatId);
  });

  bot.action('dns_prev_page', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || (session.state !== SessionState.SELECTING_DOMAIN_FOR_ALL_DNS &&
      session.state !== SessionState.VIEWING_DNS_RECORDS &&
      session.state !== SessionState.MANAGING_DNS_RECORD)) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    if (session.currentPage > 0) {
      session.currentPage--;
      await ctx.deleteMessage();
      await displayDnsRecordsPage(ctx, session);
    }

    await ctx.answerCbQuery();
  });

  bot.action('dns_next_page', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || (session.state !== SessionState.SELECTING_DOMAIN_FOR_ALL_DNS &&
      session.state !== SessionState.VIEWING_DNS_RECORDS &&
      session.state !== SessionState.MANAGING_DNS_RECORD)) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    if (session.currentPage < session.totalPages - 1) {
      session.currentPage++;
      await ctx.deleteMessage();
      await displayDnsRecordsPage(ctx, session);
    }

    await ctx.answerCbQuery();
  });

  bot.action('dns_page_info', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);
    await ctx.answerCbQuery(`第 ${session.currentPage + 1} 页，共 ${session.totalPages} 页`);
  });

  bot.action('dns_done', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    // 先回答回调查询
    await ctx.answerCbQuery('查询完成');

    // 删除当前消息
    try {
      await ctx.deleteMessage();
    } catch (error) {
      console.log('删除当前消息失败:', error.message);
    }

    // 删除所有存储的消息ID对应的消息
    if (session && session.getDnsMessageIds && session.getDnsMessageIds.length > 0) {
      for (const msgId of session.getDnsMessageIds) {
        try {
          // 跳过当前消息（已经尝试删除过）
          if (ctx.callbackQuery && msgId === ctx.callbackQuery.message.message_id) {
            continue;
          }
          await ctx.telegram.deleteMessage(chatId, msgId);
        } catch (error) {
          console.log(`删除消息ID ${msgId} 失败:`, error.message);
        }
      }
    }

    // 发送完成提示
    await ctx.reply('DNS记录查询已完成。');

    // 最后删除会话
    userSessions.delete(chatId);
  });

  // 处理域名选择回调
  bot.action(/^select_domain_all_(.+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session.getDnsMessageIds) {
      session.getDnsMessageIds = [];
    }

    // 检查会话是否存在，并且状态是选择域名、查看记录或管理记录
    if (!session || (session.state !== SessionState.SELECTING_DOMAIN_FOR_ALL_DNS &&
      session.state !== SessionState.VIEWING_DNS_RECORDS &&
      session.state !== SessionState.MANAGING_DNS_RECORD)) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    // 从回调数据中提取域名
    const domainName = ctx.match[1];
    const zoneId = await getZoneIdForDomain(domainName);

    if (!zoneId) {
      await ctx.answerCbQuery('无法找到此域名对应的Zone ID');
      await ctx.reply('无法找到此域名对应的Zone ID，请联系管理员');
      userSessions.delete(chatId);
      return;
    }

    await ctx.answerCbQuery();

    // 如果当前正在查看记录或管理记录，先删除当前消息
    if (session.state === SessionState.VIEWING_DNS_RECORDS ||
      session.state === SessionState.MANAGING_DNS_RECORD) {
      try {
        await ctx.deleteMessage();
      } catch (error) {
        console.log('删除消息失败:', error.message);
      }
    } else {
      await ctx.deleteMessage();
    }

    // 显示正在查询的提示
    const loadingMsg = await ctx.reply(`正在查询 ${domainName} 的所有DNS记录...`);

    try {
      const { records } = await getDnsRecord(domainName, true);

      // 尝试删除加载消息
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      } catch (error) {
        console.log('删除加载消息失败:', error.message);
      }

      if (records && records.length > 0) {
        // 保存记录到会话中
        session.dnsRecords = records;
        session.domain = domainName;
        session.currentPage = 0;
        session.pageSize = DNS_RECORDS_PAGE_SIZE;
        session.totalPages = Math.ceil(records.length / session.pageSize);
        session.state = SessionState.VIEWING_DNS_RECORDS;
        session.getAllRecords = true;

        // 显示第一页记录
        await displayDnsRecordsPage(ctx, session);
      } else {
        const errorMsg = await ctx.reply(`未找到 ${domainName} 的DNS记录`);
        // 不删除会话，让用户可以继续查询其他域名
        session.getDnsMessageIds.push(errorMsg.message_id);
      }
    } catch (error) {
      const errorMsg = await ctx.reply(`查询过程中发生错误: ${error.message}`);
      session.getDnsMessageIds.push(errorMsg.message_id);
      // 不删除会话，让用户可以继续查询其他域名
    }
  });

  // 处理DNS记录点击
  bot.action(/^dns_r_r(\d+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    // 允许在查看记录和管理记录状态下点击
    if (!session || (session.state !== SessionState.VIEWING_DNS_RECORDS &&
      session.state !== SessionState.MANAGING_DNS_RECORD)) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    // 从回调数据中提取记录索引
    const recordKey = `r${ctx.match[1]}`;
    const recordIndex = session.pageRecordIndices[recordKey];

    // 查找完整的记录信息
    const record = session.dnsRecords[recordIndex];
    if (!record) {
      await ctx.answerCbQuery('找不到记录信息');
      return;
    }

    // 保存记录信息到会话
    session.selectedRecord = record;
    session.state = SessionState.MANAGING_DNS_RECORD;

    // 显示记录详情和操作选项
    let recordTypeDisplay = record.type;
    if (record.type === 'A') {
      recordTypeDisplay = 'IPv4 (A)';
    } else if (record.type === 'AAAA') {
      recordTypeDisplay = 'IPv6 (AAAA)';
    }

    const recordDetails =
      `域名: ${record.name}\n` +
      `IP地址: ${record.content}\n` +
      `类型: ${recordTypeDisplay}\n` +
      `代理状态: ${record.proxied ? '已启用' : '未启用'}`;

    await ctx.answerCbQuery();

    const sentMsg = await ctx.reply(
      `DNS记录详情:\n\n${recordDetails}\n\n请选择操作:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '更新记录', callback_data: 'dns_update_record' },
              { text: '删除记录', callback_data: 'dns_delete_record' }
            ],
            [
              { text: '返回列表', callback_data: 'dns_back_to_list' }
            ]
          ]
        }
      }
    );

    // 将消息ID添加到数组中
    if (!session.getDnsMessageIds) {
      session.getDnsMessageIds = [];
    }
    session.getDnsMessageIds.push(sentMsg.message_id);
  });

  // 处理更新记录请求
  bot.action('dns_update_record', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.MANAGING_DNS_RECORD) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    session.state = SessionState.WAITING_DNS_UPDATE_NEW_IP;

    await ctx.answerCbQuery();
    await ctx.reply(
      `请输入 ${session.selectedRecord.name} 的新IP地址。\n` +
      `当前IP: ${session.selectedRecord.content}\n` +
      `支持IPv4（例如：192.168.1.1）\n` +
      `或IPv6（例如：2001:db8::1）`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '取消操作', callback_data: 'cancel_update_dns' }
          ]]
        }
      }
    );
  });

  // 处理删除记录请求
  bot.action('dns_delete_record', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.MANAGING_DNS_RECORD) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    const record = session.selectedRecord;

    await ctx.answerCbQuery();
    await ctx.reply(
      `确定要删除以下DNS记录吗？\n\n` +
      `域名: ${record.name}\n` +
      `IP地址: ${record.content}\n` +
      `类型: ${record.type}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '确认删除', callback_data: 'confirm_delete_record' },
              { text: '取消', callback_data: 'cancel_delete_record' }
            ]
          ]
        }
      }
    );
  });

  // 返回列表
  bot.action('dns_back_to_list', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    session.state = SessionState.VIEWING_DNS_RECORDS;
    delete session.selectedRecord;

    await ctx.answerCbQuery();

    await displayDnsRecordsPage(ctx, session);
  });

  // 确认删除记录
  bot.action('confirm_delete_record', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.MANAGING_DNS_RECORD) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    const record = session.selectedRecord;

    await ctx.answerCbQuery();
    await ctx.editMessageText(`正在删除 ${record.name} 的DNS记录...`);

    try {
      // 调用删除单条记录的API
      const result = await deleteSingleDnsRecord(record.zone_id, record.id);
      await ctx.reply(`DNS记录已成功删除: ${record.name}`);
    } catch (error) {
      await ctx.reply(`删除过程中发生错误: ${error.message}`);
    }

    userSessions.delete(chatId);
  });

  // 取消删除记录
  bot.action('cancel_delete_record', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    session.state = SessionState.VIEWING_DNS_RECORDS;
    delete session.selectedRecord;

    await ctx.answerCbQuery();
    await ctx.editMessageText('已取消删除操作');
    await displayDnsRecordsPage(ctx, session);
  });

  // 取消更新DNS
  bot.action('cancel_update_dns', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    session.state = SessionState.VIEWING_DNS_RECORDS;
    delete session.selectedRecord;

    await ctx.answerCbQuery();
    await ctx.editMessageText('已取消更新操作');
    await displayDnsRecordsPage(ctx, session);
  });

  // 处理新代理设置
  bot.action('dns_update_proxy_yes', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_NEW_PROXY) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    const record = session.selectedRecord;

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `正在更新: ${record.name} -> ${session.newIpAddress} ` +
      `(类型: ${record.type}, 已启用代理)`
    );

    try {
      // 检查记录是否包含必要的字段
      if (!record.zone_id || !record.id) {
        throw new Error(`记录信息不完整: zone_id=${record.zone_id}, id=${record.id}`);
      }

      console.log(`更新记录信息: ${JSON.stringify(record)}`);

      // 调用更新记录的API
      const result = await updateDnsRecord(
        record.zone_id,
        record.id,
        record.name,
        session.newIpAddress,
        record.type,
        true
      );
      await ctx.reply(`DNS记录已成功更新: ${record.name}`);
    } catch (error) {
      let errorMessage = `更新过程中发生错误: ${error.message}`;
      if (error.response) {
        errorMessage += ` (状态码: ${error.response.status})`;
      }
      await ctx.reply(errorMessage);
      console.error('更新DNS记录时出错:', error);
    }

    userSessions.delete(chatId);
  });

  bot.action('dns_update_proxy_no', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_NEW_PROXY) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    const record = session.selectedRecord;

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `正在更新: ${record.name} -> ${session.newIpAddress} ` +
      `(类型: ${record.type}, 未启用代理)`
    );

    try {
      // 检查记录是否包含必要的字段
      if (!record.zone_id || !record.id) {
        throw new Error(`记录信息不完整: zone_id=${record.zone_id}, id=${record.id}`);
      }

      console.log(`更新记录信息: ${JSON.stringify(record)}`);

      // 调用更新记录的API
      const result = await updateDnsRecord(
        record.zone_id,
        record.id,
        record.name,
        session.newIpAddress,
        record.type,
        false
      );
      await ctx.reply(`DNS记录已成功更新: ${record.name}`);
    } catch (error) {
      let errorMessage = `更新过程中发生错误: ${error.message}`;
      if (error.response) {
        errorMessage += ` (状态码: ${error.response.status})`;
      }
      await ctx.reply(errorMessage);
      console.error('更新DNS记录时出错:', error);
    }

    userSessions.delete(chatId);
  });

  // 处理域名选择回调
  bot.action(/^select_domain_query_(.+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.SELECTING_DOMAIN_FOR_QUERY) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    const rootDomain = ctx.match[1];
    session.rootDomain = rootDomain;
    session.state = SessionState.WAITING_SUBDOMAIN_INPUT;

    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    const sentMsg = await ctx.reply(
      `已选择域名: ${rootDomain}\n\n` +
      `请输入子域名前缀（如：www），或直接发送 "." 查询根域名。\n\n` +
      `例如：输入 "www" 将查询 www.${rootDomain}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '查询根域名', callback_data: 'query_root_domain' },
            { text: '取消操作', callback_data: 'cancel_getdns' }
          ]]
        }
      }
    );

    // 保存消息ID到会话
    session.waitSubDomainMessageId = sentMsg.message_id;
  });

  // 处理查询根域名的回调
  bot.action('query_root_domain', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_SUBDOMAIN_INPUT) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    await ctx.answerCbQuery();
    await queryDomainRecords(ctx, session.rootDomain);
  });

  // 处理设置DNS的域名选择
  bot.action(/^select_domain_set_(.+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.SELECTING_DOMAIN_FOR_SET) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    const rootDomain = ctx.match[1];
    session.rootDomain = rootDomain;
    session.state = SessionState.WAITING_SUBDOMAIN_FOR_SET;

    await ctx.answerCbQuery();
    await ctx.reply(
      `已选择域名: ${rootDomain}\n\n` +
      `请输入子域名前缀（如：www），或直接发送 "." 设置根域名。\n\n` +
      `例如：输入 "www" 将设置 www.${rootDomain}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '设置根域名', callback_data: 'set_root_domain' },
            { text: '取消操作', callback_data: 'cancel_setdns' }
          ]]
        }
      }
    );
  });

  // 处理删除DNS的域名选择
  bot.action(/^select_domain_del_(.+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.SELECTING_DOMAIN_FOR_DELETE) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    const rootDomain = ctx.match[1];
    session.rootDomain = rootDomain;
    session.state = SessionState.WAITING_SUBDOMAIN_FOR_DELETE;

    await ctx.answerCbQuery();
    await ctx.reply(
      `已选择域名: ${rootDomain}\n\n` +
      `请输入子域名前缀（如：www），或直接发送 "." 删除根域名。\n\n` +
      `例如：输入 "www" 将删除 www.${rootDomain}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '删除根域名', callback_data: 'del_root_domain' },
            { text: '取消操作', callback_data: 'cancel_deldns' }
          ]]
        }
      }
    );
  });

  // 处理设置根域名的回调
  bot.action('set_root_domain', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_SUBDOMAIN_FOR_SET) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    // 直接使用根域名
    session.domain = session.rootDomain;
    session.state = SessionState.WAITING_IP;

    await ctx.answerCbQuery();
    await ctx.reply(
      `请输入 ${session.domain} 的IP地址。\n` +
      '支持IPv4（例如：192.168.1.1）\n' +
      '或IPv6（例如：2001:db8::1）',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '取消操作', callback_data: 'cancel_setdns' }
          ]]
        }
      }
    );
  });

  // 处理删除根域名的回调
  bot.action('del_root_domain', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_SUBDOMAIN_FOR_DELETE) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    try {
      const { records } = await getDnsRecord(session.rootDomain);
      if (!records || records.length === 0) {
        await ctx.answerCbQuery();
        await ctx.reply(`未找到 ${session.rootDomain} 的DNS记录`);
        userSessions.delete(chatId);
        return;
      }

      session.domain = session.rootDomain;
      session.state = SessionState.WAITING_CONFIRM_DELETE;

      const recordsInfo = records.map(record =>
        `类型: ${record.type}\n内容: ${record.content}`
      ).join('\n\n');

      await ctx.answerCbQuery();
      await ctx.reply(
        `找到以下DNS记录：\n\n${recordsInfo}\n\n确定要删除这些记录吗？`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '确认删除', callback_data: 'confirm_delete' },
                { text: '取消', callback_data: 'cancel_delete' }
              ]
            ]
          }
        }
      );
    } catch (error) {
      await ctx.answerCbQuery();
      await ctx.reply(`查询DNS记录时发生错误: ${error.message}`);
      userSessions.delete(chatId);
    }
  });

  // 处理DDNS域名选择
  bot.action(/^select_domain_ddns_(.+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.SELECTING_DOMAIN_FOR_DDNS) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    const rootDomain = ctx.match[1];
    session.rootDomain = rootDomain;
    session.state = SessionState.WAITING_SUBDOMAIN_FOR_DDNS;

    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    await ctx.reply(
      `已选择域名: ${rootDomain}\n\n` +
      `请输入子域名前缀（如：www），或直接发送 "." 设置根域名。\n\n` +
      `例如：输入 "www" 将设置 www.${rootDomain}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '设置根域名', callback_data: 'set_root_domain_ddns' },
            { text: '取消操作', callback_data: 'cancel_ddns' }
          ]]
        }
      }
    );
  });

  // 处理设置根域名DDNS
  bot.action('set_root_domain_ddns', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_SUBDOMAIN_FOR_DDNS) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    // 直接使用根域名
    session.domain = session.rootDomain;
    session.state = SessionState.WAITING_INTERVAL_FOR_DDNS;

    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    await ctx.reply(
      `请输入 ${session.domain} 的DDNS刷新间隔（秒）。\n或选择预设事件间隔：`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '60秒', callback_data: 'ddns_interval_60' },
              { text: '5分钟', callback_data: 'ddns_interval_300' },
              { text: '10分钟', callback_data: 'ddns_interval_600' }
            ],
            [
              { text: '取消操作', callback_data: 'cancel_ddns' }
            ]
          ]
        }
      }
    );
  });

  // 处理DDNS间隔选择
  bot.action(/^ddns_interval_(\d+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions.get(chatId);

    if (!session || session.state !== SessionState.WAITING_INTERVAL_FOR_DDNS) {
      await ctx.answerCbQuery('会话已过期');
      return;
    }

    const interval = parseInt(ctx.match[1]);
    await setupDDNS(ctx, session, interval);
  });

  // 取消DDNS设置
  bot.action('cancel_ddns', async (ctx) => {
    const chatId = ctx.chat.id;
    userSessions.delete(chatId);
    await ctx.answerCbQuery();
    await ctx.editMessageText('已取消DDNS设置操作。');
  });

  // 取消停止DDNS
  bot.action('cancel_stop_ddns', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('已取消停止DDNS操作。');
  });

  // 停止特定DDNS任务
  bot.action(/^stop_ddns_(.+)$/, async (ctx) => {
    const domain = ctx.match[1];
    const result = stopDDNS(domain);

    await ctx.answerCbQuery();
    if (result) {
      await ctx.editMessageText(`已停止 ${domain} 的DDNS任务。`);
    } else {
      await ctx.editMessageText(`未找到 ${domain} 的DDNS任务。`);
    }
  });

  // 停止所有DDNS任务
  bot.action('stop_all_ddns', async (ctx) => {
    const tasks = getAllDDNSTasks();
    let stoppedCount = 0;

    for (const task of tasks) {
      if (stopDDNS(task.domain)) {
        stoppedCount++;
      }
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText(`已停止所有DDNS任务，共${stoppedCount}个。`);
  });
}

module.exports = { setupCallbacks };
