/**
 * Jest stand-in for @shopify/react-native-skia (P4b). Skia's real module
 * needs native JSI bindings (or a CanvasKit WASM download), which unit tests
 * don't have. Ink LOGIC is plain TypeScript and tested directly; this stub
 * only lets modules that also export Skia components be imported. Drawing
 * itself is checked on devices (Ink diagnostics screen, TESTING_ON_DEVICE).
 */
import { View } from 'react-native';

class StubPath {
  private cmds: string[] = [];
  static MakeFromSVGString(d: string): StubPath {
    const p = new StubPath();
    p.cmds.push(d);
    return p;
  }
  toSVGString(): string {
    return this.cmds.join('');
  }
  copy(): StubPath {
    const p = new StubPath();
    p.cmds = [...this.cmds];
    return p;
  }
}

class StubPathBuilder {
  private cmds: string[] = [];
  moveTo(x: number, y: number) {
    this.cmds.push(`M${x} ${y}`);
    return this;
  }
  lineTo(x: number, y: number) {
    this.cmds.push(`L${x} ${y}`);
    return this;
  }
  addPath() {
    return this;
  }
  reset() {
    this.cmds = [];
    return this;
  }
  build(): StubPath {
    return StubPath.MakeFromSVGString(this.cmds.join(''));
  }
  detach(): StubPath {
    const p = this.build();
    this.cmds = [];
    return p;
  }
}

export const Skia = {
  Path: { Make: () => new StubPath(), MakeFromSVGString: (d: string) => StubPath.MakeFromSVGString(d) },
  PathBuilder: { Make: () => new StubPathBuilder() },
};

export type SkPath = StubPath;

export const Canvas = ({ children }: { children?: unknown }) => <View testID="skia-canvas">{children as never}</View>;
export const Path = () => null;
export const Group = ({ children }: { children?: unknown }) => <>{children as never}</>;
