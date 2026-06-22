import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { auditQueries } from '../db/index';

const SMB_CONF = '/etc/samba/smb.conf';
const MANAGED_BEGIN = '# >>> core-hub managed shares >>>';
const MANAGED_END = '# <<< core-hub managed shares <<<';

interface Share {
  name: string;
  path: string;
  readOnly: boolean;
  guestOk: boolean;
  browseable: boolean;
}

function readConf(): string {
  return safeExec(`cat ${SMB_CONF} 2>/dev/null`, 4000);
}

/** Parse only the core-hub managed block into share objects. */
function parseShares(conf: string): Share[] {
  const start = conf.indexOf(MANAGED_BEGIN);
  const end = conf.indexOf(MANAGED_END);
  if (start === -1 || end === -1) return [];
  const block = conf.slice(start, end);
  const shares: Share[] = [];
  let current: Share | null = null;
  for (const line of block.split('\n')) {
    const t = line.trim();
    const section = t.match(/^\[([^\]]+)\]$/);
    if (section) {
      if (current) shares.push(current);
      current = { name: section[1], path: '', readOnly: true, guestOk: false, browseable: true };
    } else if (current) {
      const kv = t.match(/^([^=]+)=(.+)$/);
      if (!kv) continue;
      const key = kv[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const val = kv[2].trim();
      if (key === 'path') current.path = val;
      if (key === 'read only') current.readOnly = /yes/i.test(val);
      if (key === 'guest ok') current.guestOk = /yes/i.test(val);
      if (key === 'browseable' || key === 'browsavle') current.browseable = /yes/i.test(val);
    }
  }
  if (current) shares.push(current);
  return shares;
}

function renderShare(s: Share): string {
  return `[${s.name}]
   path = ${s.path}
   read only = ${s.readOnly ? 'yes' : 'no'}
   guest ok = ${s.guestOk ? 'yes' : 'no'}
   browseable = ${s.browseable ? 'yes' : 'no'}
`;
}

function writeShares(shares: Share[]): void {
  const conf = readConf();
  const start = conf.indexOf(MANAGED_BEGIN);
  const end = conf.indexOf(MANAGED_END);
  const block = `${MANAGED_BEGIN}\n${shares.map(renderShare).join('\n')}${MANAGED_END}\n`;

  let newConf: string;
  if (start !== -1 && end !== -1) {
    newConf = conf.slice(0, start) + block + conf.slice(end + MANAGED_END.length + 1);
  } else {
    newConf = conf.replace(/\n*$/, '\n\n') + block;
  }

  const tmp = `/tmp/corehub-smb-${Date.now()}.conf`;
  fs.writeFileSync(tmp, newConf);
  privExec(`cp ${tmp} ${SMB_CONF}`);
  fs.unlinkSync(tmp);
  // Validate + reload
  safeExec('testparm -s 2>/dev/null >/dev/null');
  privExec('systemctl reload smbd 2>/dev/null || systemctl restart smbd', { timeout: 12000 });
}

export async function shareRoutes(fastify: FastifyInstance) {
  fastify.get('/api/shares', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('smbd')) {
      return reply.send({ available: false, shares: [], message: 'Samba nicht installiert (apt install samba)' });
    }
    const running = safeExec('systemctl is-active smbd 2>/dev/null').trim() === 'active';
    reply.send({ available: true, running, shares: parseShares(readConf()) });
  });

  fastify.post<{ Body: Share }>('/api/shares', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('smbd')) return reply.status(503).send({ error: 'Samba nicht installiert' });
    const body = req.body;
    const name = (body?.name ?? '').replace(/[^a-zA-Z0-9 _-]/g, '');
    if (!name || !body?.path?.startsWith('/')) return reply.status(400).send({ error: 'Name und absoluter Pfad erforderlich' });
    try {
      privExec(`mkdir -p ${body.path.replace(/[^a-zA-Z0-9 ._/-]/g, '')}`);
      const shares = parseShares(readConf()).filter((s) => s.name !== name);
      shares.push({
        name,
        path: body.path,
        readOnly: body.readOnly ?? false,
        guestOk: body.guestOk ?? false,
        browseable: body.browseable ?? true,
      });
      writeShares(shares);
      auditQueries.log.run(req.user.id, 'share.create', name);
      reply.status(201).send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Samba-Fehler' });
    }
  });

  fastify.delete<{ Params: { name: string } }>('/api/shares/:name', { preHandler: requireAdmin }, async (req, reply) => {
    const name = req.params.name;
    try {
      const shares = parseShares(readConf()).filter((s) => s.name !== name);
      writeShares(shares);
      auditQueries.log.run(req.user.id, 'share.delete', name);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Samba-Fehler' });
    }
  });

  fastify.post<{ Body: { action: 'start' | 'stop' | 'restart' } }>(
    '/api/shares/service',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const action = req.body?.action;
      if (!['start', 'stop', 'restart'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      try {
        privExec(`systemctl ${action} smbd nmbd 2>/dev/null || systemctl ${action} smbd`, { timeout: 12000 });
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Samba-Fehler' });
      }
    }
  );

  // Add an SMB user (must already exist as a Linux user)
  fastify.post<{ Body: { username: string; password: string } }>(
    '/api/shares/user',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const username = (req.body?.username ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
      const password = req.body?.password ?? '';
      if (!username || !password) return reply.status(400).send({ error: 'Benutzer und Passwort erforderlich' });
      try {
        privExec(`bash -c "(echo '${password}'; echo '${password}') | smbpasswd -s -a ${username}"`, { timeout: 8000 });
        auditQueries.log.run(req.user.id, 'share.adduser', username);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'smbpasswd-Fehler' });
      }
    }
  );
}
