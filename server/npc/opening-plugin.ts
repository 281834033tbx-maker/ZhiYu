import type {Plugin} from 'vite';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {openingServiceFor} from './opening-service';

/** A single host timer serves all newly registered accounts. No model request
 * or open browser tab is needed for the two delayed fixed introductions. */
export function npcOpeningLocal(options: {now?: () => number; automatic?: boolean} = {}): Plugin {
  return {name: 'zhiyu-fixed-openings', apply: 'serve', configureServer(server) {
    const root = server.config.root;
    mkdirSync(join(root, '.npc-runtime'), {recursive: true});
    const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
    db.exec('PRAGMA journal_mode=WAL');
    const service = openingServiceFor(db, root, options.now);
    const timer = options.automatic === false ? undefined : setInterval(() => {
      try {service.tick();} catch { /* Keep eligibility queued for a later tick. */ }
    }, 1000);
    timer?.unref();
    server.httpServer?.once('close', () => {if (timer) clearInterval(timer); db.close();});
  }};
}
