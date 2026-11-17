import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInitialState, isValidState } from '../shared/state';
import type { AppState } from '../shared/types';

export class StateStore {
  state: AppState = createInitialState();
  readonly file: string;
  constructor(readonly directory: string) { this.file = path.join(directory, 'state.json'); }

  async load(): Promise<string | null> {
    await fs.mkdir(this.directory, { recursive: true });
    let text: string;
    try { text = await fs.readFile(this.file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.save(this.state);
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isValidState(parsed)) throw new Error('Invalid state');
      this.state = parsed;
      return null;
    } catch {
      const recovery = path.join(this.directory, `state-recovery-${Date.now()}.json`);
      await fs.copyFile(this.file, recovery);
      await this.save(createInitialState());
      return recovery;
    }
  }

  async save(next: AppState): Promise<void> {
    if (!isValidState(next)) throw new Error('数据格式无效，未保存更改。');
    const temporary = `${this.file}.tmp`;
    const handle = await fs.open(temporary, 'w');
    try {
      await handle.writeFile(JSON.stringify(next, null, 2), 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, this.file);
    this.state = next;
  }
}
