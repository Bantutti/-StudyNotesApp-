/**
 * Ink undo/redo (decision Q5): an op stack for the current note visit, capped
 * at INK_LIMITS.maxHistory steps. Separate from TipTap's text undo: in Draw
 * mode the toolbar's Undo/Redo use this history; Type mode keeps TipTap's.
 *
 * The history stores the ops AS APPLIED (with their real stroke ids). When
 * applying an undo/redo or a re-anchor gives strokes new ids (layer.applyOp
 * idMap), remap() rewrites every stored op, so later steps still find them.
 */
import type { InkStroke } from './format';
import { inverseOp, type InkOp } from './layer';
import { INK_LIMITS } from './limits';

export interface InkHistory {
  /** Records a new user action (clears redo). */
  push(op: InkOp): void;
  /** The op to apply for Undo, or null. Call commitUndo() after applying it. */
  peekUndo(): InkOp | null;
  /** The op to apply for Redo, or null. Call commitRedo() after applying it. */
  peekRedo(): InkOp | null;
  /** Moves the top undo step to redo, storing the op as applied. */
  commitUndo(applied: InkOp): void;
  /** Moves the top redo step to undo, storing the op as applied. */
  commitRedo(applied: InkOp): void;
  /** Rewrites stroke ids in every stored op (old id -> new id). */
  remap(idMap: ReadonlyMap<string, string>): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly size: number;
  clear(): void;
}

const remapStroke = (s: InkStroke, m: ReadonlyMap<string, string>): InkStroke => {
  const id = m.get(s.id);
  return id ? { ...s, id } : s;
};
const remapOp = (op: InkOp, m: ReadonlyMap<string, string>): InkOp => ({
  remove: op.remove.map((s) => remapStroke(s, m)),
  add: op.add.map((s) => remapStroke(s, m)),
});

export function createInkHistory(max: number = INK_LIMITS.maxHistory): InkHistory {
  // Each stack entry is the op that was DONE; undo applies its inverse.
  let undo: InkOp[] = [];
  let redo: InkOp[] = [];
  return {
    push(op) {
      if (op.add.length === 0 && op.remove.length === 0) return;
      undo.push(op);
      if (undo.length > max) undo = undo.slice(undo.length - max);
      redo = [];
    },
    peekUndo() {
      const top = undo[undo.length - 1];
      return top ? inverseOp(top) : null;
    },
    peekRedo() {
      return redo[redo.length - 1] ?? null;
    },
    commitUndo(applied) {
      if (!undo.length) return;
      undo.pop();
      // `applied` is the inverse as applied; redo replays its inverse.
      redo.push(inverseOp(applied));
    },
    commitRedo(applied) {
      if (!redo.length) return;
      redo.pop();
      undo.push(applied);
      if (undo.length > max) undo = undo.slice(undo.length - max);
    },
    remap(idMap) {
      if (idMap.size === 0) return;
      undo = undo.map((op) => remapOp(op, idMap));
      redo = redo.map((op) => remapOp(op, idMap));
    },
    get canUndo() {
      return undo.length > 0;
    },
    get canRedo() {
      return redo.length > 0;
    },
    get size() {
      return undo.length;
    },
    clear() {
      undo = [];
      redo = [];
    },
  };
}
