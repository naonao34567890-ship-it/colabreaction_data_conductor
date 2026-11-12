import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export async function resolveAccount(token, configured, request = fetch) {
  if (!token) throw new Error('Set repository secret CLOUDFLARE_API_TOKEN');
  async function get(path) {
    const response = await request(`https://api.cloudflare.com/client/v4${path}`, {headers:{Authorization:`Bearer ${token}`}});
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(`Cloudflare configuration lookup failed (${response.status}); check token permissions or set CLOUDFLARE_ACCOUNT_ID.`);
    return body;
  }
  let accounts = [];
  if (configured) {
    if (!/^[a-f0-9]{32}$/.test(configured)) throw new Error('Invalid CLOUDFLARE_ACCOUNT_ID');
    accounts = [{id:configured}];
  } else {
    for (let page=1; ; page++) {
      const body = await get(`/accounts?per_page=50&page=${page}`);
      accounts.push(...body.result);
      if (page >= (body.result_info?.total_pages || 1)) break;
    }
  }
  const matches = [];
  for (const account of accounts) {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account.id}/workers/scripts/mol-bench-drive/settings`, {headers:{Authorization:`Bearer ${token}`}});
    if (response.status === 404) continue;
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(`Cannot verify Worker settings (${response.status}).`);
    if (body.result.bindings?.some(b => b.name === 'DRIVE_KV' && b.namespace_id === '368f59c248824ca49faff59bdbe4b92f')) matches.push(account.id);
  }
  if (matches.length !== 1) throw new Error('Expected exactly one account with the existing mol-bench-drive Worker and DRIVE_KV binding; set CLOUDFLARE_ACCOUNT_ID and check permissions.');
  return matches[0];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (['both','worker'].includes(process.env.TARGET)) {
      const id = await resolveAccount(process.env.CF_TOKEN, process.env.CF_ACCOUNT);
      appendFileSync(process.env.GITHUB_OUTPUT, `cloudflare_account_id=${id}\n`);
      console.log('Verified the existing Worker account and Drive KV binding.');
    }
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
