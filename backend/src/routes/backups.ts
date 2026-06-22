import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { backupQueries, auditQueries } from '../db/index';
import { privExec, safeExec, hasBinary } from '../lib/privilege';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.env.DATA_DIR || process.cwd(), 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function fileSize(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function backupRoutes(fastify: FastifyInstance) {
  ensureBackupDir();

  fastify.get('/api/backups', { preHandler: requireAuth }, async (_req, reply) => {
    const backups = backupQueries.getAll.all().map((b) => ({
      ...b,
      exists: fs.existsSync(b.path),
    }));
    reply.send({ backups, dir: BACKUP_DIR });
  });

  // ── Backup a Docker container's named volumes (via busybox, no host root needed) ──
  fastify.post<{ Body: { containerId: string; stop?: boolean } }>(
    '/api/backups/container',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { containerId, stop } = req.body ?? {};
      if (!containerId) return reply.status(400).send({ error: 'Container-ID erforderlich' });
      try {
        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        const name = safeName(info.Name.replace(/^\//, ''));
        const volumes = (info.Mounts ?? []).filter((m) => m.Type === 'volume' || m.Type === 'bind');

        if (volumes.length === 0) {
          return reply.status(400).send({ error: 'Container hat keine Volumes zum Sichern' });
        }

        const wasRunning = info.State.Running;
        if (stop && wasRunning) await container.stop();

        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `container-${name}-${ts}.tar.gz`;
        const outPath = path.join(BACKUP_DIR, fileName);

        // Mount every volume read-only into busybox and tar them together.
        const mountArgs = volumes
          .map((m, i) => `-v ${m.Type === 'volume' ? m.Name : m.Source}:/backup-src/${i}:ro`)
          .join(' ');
        const cmd = `docker run --rm ${mountArgs} -v ${BACKUP_DIR}:/backup busybox tar czf /backup/${fileName} -C /backup-src .`;
        execSync(cmd, { timeout: 300000 });

        if (stop && wasRunning) await container.start();

        const size = fileSize(outPath);
        backupQueries.create.run('container', name, containerId, outPath, size, 'ok');
        auditQueries.log.run(req.user.id, 'backup.container', name);
        reply.status(201).send({ ok: true, file: fileName, size });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Backup fehlgeschlagen' });
      }
    }
  );

  // ── Backup an arbitrary directory ──
  fastify.post<{ Body: { dir: string; label?: string } }>(
    '/api/backups/directory',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { dir, label } = req.body ?? {};
      if (!dir || !dir.startsWith('/')) return reply.status(400).send({ error: 'Absoluter Pfad erforderlich' });
      if (!fs.existsSync(dir)) return reply.status(400).send({ error: 'Verzeichnis existiert nicht' });
      try {
        const name = safeName(label || path.basename(dir) || 'root');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `dir-${name}-${ts}.tar.gz`;
        const outPath = path.join(BACKUP_DIR, fileName);
        privExec(`tar czf ${outPath} -C ${path.dirname(dir)} ${path.basename(dir)}`, { timeout: 600000 });
        const size = fileSize(outPath);
        backupQueries.create.run('directory', name, dir, outPath, size, 'ok');
        auditQueries.log.run(req.user.id, 'backup.directory', dir);
        reply.status(201).send({ ok: true, file: fileName, size });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Backup fehlgeschlagen' });
      }
    }
  );

  // ── Backup a VM's qcow2 disk(s) ──
  fastify.post<{ Body: { vm: string } }>(
    '/api/backups/vm',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const vm = safeName(req.body?.vm ?? '');
      if (!vm) return reply.status(400).send({ error: 'VM-Name erforderlich' });
      if (!hasBinary('virsh')) return reply.status(503).send({ error: 'libvirt nicht verfügbar' });
      try {
        const xml = privExec(`virsh dumpxml ${vm}`, { timeout: 8000 });
        const disks = [...xml.matchAll(/<source file='([^']+\.qcow2)'/g)].map((m) => m[1]);
        if (disks.length === 0) return reply.status(400).send({ error: 'Keine qcow2-Disk gefunden' });

        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `vm-${vm}-${ts}.qcow2`;
        const outPath = path.join(BACKUP_DIR, fileName);
        // Compressed copy of the first disk
        privExec(`qemu-img convert -O qcow2 -c ${disks[0]} ${outPath}`, { timeout: 1800000 });

        const size = fileSize(outPath);
        backupQueries.create.run('vm', vm, disks[0], outPath, size, 'ok');
        auditQueries.log.run(req.user.id, 'backup.vm', vm);
        reply.status(201).send({ ok: true, file: fileName, size });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'VM-Backup fehlgeschlagen' });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/backups/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      const row = backupQueries.getById.get(id);
      if (!row) return reply.status(404).send({ error: 'Backup nicht gefunden' });
      try {
        if (fs.existsSync(row.path)) {
          if (row.path.startsWith(BACKUP_DIR)) fs.unlinkSync(row.path);
          else safeExec(`rm -f ${row.path}`);
        }
        backupQueries.delete.run(id);
        auditQueries.log.run(req.user.id, 'backup.delete', row.name);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Löschen fehlgeschlagen' });
      }
    }
  );

  // Download a backup file
  fastify.get<{ Params: { id: string } }>(
    '/api/backups/:id/download',
    { preHandler: requireAuth },
    async (req, reply) => {
      const row = backupQueries.getById.get(parseInt(req.params.id));
      if (!row || !fs.existsSync(row.path)) return reply.status(404).send({ error: 'Datei nicht gefunden' });
      const stream = fs.createReadStream(row.path);
      reply.header('Content-Disposition', `attachment; filename="${path.basename(row.path)}"`);
      reply.type('application/gzip');
      return reply.send(stream);
    }
  );

  // List backup-able containers (with volumes)
  fastify.get('/api/backups/sources', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const containers = await docker.listContainers({ all: true });
      const list = await Promise.all(
        containers.map(async (c) => {
          const info = await docker.getContainer(c.Id).inspect().catch(() => null);
          const volumes = info ? (info.Mounts ?? []).filter((m) => m.Type === 'volume' || m.Type === 'bind').length : 0;
          return {
            id: c.Id,
            name: (c.Names[0] ?? '').replace(/^\//, ''),
            state: c.State,
            volumes,
          };
        })
      );
      reply.send({ containers: list.filter((c) => c.volumes > 0) });
    } catch {
      reply.send({ containers: [] });
    }
  });
}
