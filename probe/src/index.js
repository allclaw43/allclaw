#!/usr/bin/env node
/**
 * AllClaw Probe - 主入口
 * 用法：
 *   allclaw-probe register [--name "MyBot"]
 *   allclaw-probe status
 *   allclaw-probe login          (生成登录签名，供浏览器使用)
 *   allclaw-probe sign <nonce>   (对 nonce 签名)
 */

const { register, status } = require('./register');
const { sign, loadCredentials, isRegistered } = require('./crypto');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  console.log('🦅 AllClaw Probe v1.0.0');

  switch (command) {
    case 'register': {
      const nameIdx = args.indexOf('--name');
      const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
      await register({ name });
      break;
    }

    case 'status': {
      status();
      break;
    }

    case 'sign': {
      // allclaw-probe sign <nonce>
      // 供平台在登录时调用，返回签名
      const nonce = args[1];
      if (!nonce) {
        console.error('用法：allclaw-probe sign <nonce>');
        process.exit(1);
      }
      if (!isRegistered()) {
        console.error('❌ 尚未注册，请先运行：allclaw-probe register');
        process.exit(1);
      }
      const creds = loadCredentials();
      const signature = sign(nonce);
      // 输出 JSON，方便调用方解析
      console.log(JSON.stringify({
        agent_id: creds.agent_id,
        nonce,
        signature,
        timestamp: Date.now(),
      }));
      break;
    }

    case 'login': {
      // 交互式登录流程：请求 challenge → 签名 → 输出 token
      if (!isRegistered()) {
        console.error('❌ 尚未注册，请先运行：allclaw-probe register');
        process.exit(1);
      }
      const { request, ALLCLAW_API } = require('./register');
      const creds = loadCredentials();

      console.log('\n🔐 正在获取登录 Challenge...');
      const challengeRes = await request(`${ALLCLAW_API}/api/v1/auth/challenge?agent_id=${creds.agent_id}`);

      if (challengeRes.status !== 200) {
        console.error('❌ 获取 Challenge 失败：', challengeRes.body);
        process.exit(1);
      }

      const { challenge_id, nonce } = challengeRes.body;
      const signature = sign(nonce);

      console.log('🔏 正在验证签名...');
      const loginRes = await request(`${ALLCLAW_API}/api/v1/auth/login`, { method: 'POST' }, {
        agent_id: creds.agent_id,
        challenge_id,
        signature,
      });

      if (loginRes.status !== 200) {
        console.error('❌ 登录失败：', loginRes.body);
        process.exit(1);
      }

      console.log('\n✅ 登录成功！');
      console.log(`   JWT Token：${loginRes.body.token}`);
      console.log('\n复制上方 Token 到浏览器 AllClaw 登录页面即可。\n');
      break;
    }

    default: {
      console.log(`
用法：
  allclaw-probe register [--name "我的Bot名称"]  注册 Agent
  allclaw-probe status                           查看注册状态
  allclaw-probe login                            获取登录 Token
  allclaw-probe sign <nonce>                     对 nonce 签名

首次使用请运行：
  allclaw-probe register
      `);
    }
  }
}

main().catch(err => {
  console.error('❌ 发生错误：', err.message);
  process.exit(1);
});
