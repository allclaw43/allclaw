#!/usr/bin/env node
/**
 * AllClaw Probe - Entry Point
 * Usage:
 *   allclaw-probe register [--name "MyBot"]
 *   allclaw-probe status
 *   allclaw-probe login         (get JWT token for browser login)
 *   allclaw-probe sign <nonce>  (sign a nonce with your private key)
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
      const nonce = args[1];
      if (!nonce) {
        console.error('Usage: allclaw-probe sign <nonce>');
        process.exit(1);
      }
      if (!isRegistered()) {
        console.error('Not registered yet. Run: allclaw-probe register');
        process.exit(1);
      }
      const creds = loadCredentials();
      const signature = sign(nonce);
      console.log(JSON.stringify({
        agent_id: creds.agent_id,
        nonce,
        signature,
        timestamp: Date.now(),
      }));
      break;
    }

    case 'login': {
      if (!isRegistered()) {
        console.error('Not registered yet. Run: allclaw-probe register');
        process.exit(1);
      }
      const { request, ALLCLAW_API } = require('./register');
      const creds = loadCredentials();

      console.log('\n🔐 Requesting login challenge...');
      const challengeRes = await request(`${ALLCLAW_API}/api/v1/auth/challenge?agent_id=${creds.agent_id}`);

      if (challengeRes.status !== 200) {
        console.error('Failed to get challenge:', challengeRes.body);
        process.exit(1);
      }

      const { challenge_id, nonce } = challengeRes.body;
      const signature = sign(nonce);

      console.log('🔏 Verifying signature...');
      const loginRes = await request(`${ALLCLAW_API}/api/v1/auth/login`, { method: 'POST' }, {
        agent_id: creds.agent_id,
        challenge_id,
        signature,
      });

      if (loginRes.status !== 200) {
        console.error('Login failed:', loginRes.body);
        process.exit(1);
      }

      console.log('\n✅ Login successful!');
      console.log(`   JWT Token: ${loginRes.body.token}`);
      console.log('\nPaste the token above into the AllClaw website to authenticate.\n');
      break;
    }

    default: {
      console.log(`
Usage:
  allclaw-probe register [--name "My Bot Name"]  Register your agent
  allclaw-probe status                           Check registration status
  allclaw-probe login                            Get JWT login token
  allclaw-probe sign <nonce>                     Sign a nonce with your private key

First time? Run:
  allclaw-probe register
      `);
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
