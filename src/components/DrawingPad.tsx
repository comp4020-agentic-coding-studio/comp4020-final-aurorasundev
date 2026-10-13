import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { DRAWING_HEIGHT, DRAWING_WIDTH } from "../lib/api.ts";

// A sheet to draw on: one ink pen, an eraser, undo and clear. Strokes are kept
// as points in sheet pixels and replayed onto a fixed-size canvas, so the
// drawing is the same whatever size the sheet is shown at. Nothing is kept
// outside this component: like a typed draft, it is gone if the dialog closes.

// White ground: shown with multiply, it leaves the paper beneath unchanged.
const PAPER = "#ffffff";
const INK = "#292927";
const PEN_WIDTH = 6;
const ERASER_WIDTH = 36;

type Tool = "pen" | "eraser";
type Stroke = { tool: Tool; points: [number, number][] };

export type DrawingPadHandle = {
  // the drawing as a PNG data URL, or null if nothing is on the sheet
  toDataUrl(): string | null;
};

type Props = {
  disabled?: boolean;
  onChange: (hasMarks: boolean) => void;
};

export const DrawingPad = forwardRef<DrawingPadHandle, Props>(function DrawingPad({ disabled = false, onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<{ stroke: Stroke; pointerId: number } | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [count, setCount] = useState(0);

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, DRAWING_WIDTH, DRAWING_HEIGHT);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const { tool: t, points } of strokes.current) {
      ctx.strokeStyle = t === "pen" ? INK : PAPER;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = t === "pen" ? PEN_WIDTH : ERASER_WIDTH;
      if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0][0], points[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      // midpoints as curve ends, so a quick stroke reads as a line, not facets
      for (let i = 1; i < points.length - 1; i++) {
        const [x, y] = points[i];
        const [nx, ny] = points[i + 1];
        ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last[0], last[1]);
      ctx.stroke();
    }
  }, []);

  useEffect(paint, [paint]);

  // Whether any ink is left on the sheet, read from the pixels: a line that
  // was drawn and then erased leaves a blank sheet, not a drawing.
  const hasInk = (): boolean => {
    if (!strokes.current.some((s) => s.tool === "pen")) return false;
    const data = canvasRef.current!.getContext("2d")!.getImageData(0, 0, DRAWING_WIDTH, DRAWING_HEIGHT).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 200) return true;
    return false;
  };

  const changed = () => {
    setCount(strokes.current.length);
    onChange(hasInk());
  };

  useImperativeHandle(ref, () => ({
    toDataUrl: () => (hasInk() ? canvasRef.current!.toDataURL("image/png") : null),
  }));

  const point = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [
      Math.round(((e.clientX - rect.left) / rect.width) * DRAWING_WIDTH * 10) / 10,
      Math.round(((e.clientY - rect.top) / rect.height) * DRAWING_HEIGHT * 10) / 10,
    ];
  };

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || current.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke: Stroke = { tool, points: [point(e)] };
    strokes.current.push(stroke);
    current.current = { stroke, pointerId: e.pointerId };
    paint();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const active = current.current;
    if (!active || e.pointerId !== active.pointerId) return;
    // coalesced events keep fast strokes smooth where the browser offers them
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) active.stroke.points.push(point(ev));
    paint();
  }

  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!current.current || e.pointerId !== current.current.pointerId) return;
    current.current = null;
    changed();
  }

  function undo() {
    strokes.current.pop();
    paint();
    changed();
  }

  function clear() {
    strokes.current = [];
    paint();
    changed();
  }

  return (
    <div className="drawing-pad">
      <canvas
        ref={canvasRef}
        width={DRAWING_WIDTH}
        height={DRAWING_HEIGHT}
        className={`drawing-canvas${tool === "eraser" ? " is-erasing" : ""}`}
        role="img"
        aria-label={count ? "Your drawing" : "Empty sheet. Draw with a mouse, finger or pen."}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="drawing-tools" role="toolbar" aria-label="Drawing tools">
        <button type="button" className="drawing-tool" aria-pressed={tool === "pen"} onClick={() => setTool("pen")} disabled={disabled}>
          Pen
        </button>
        <button type="button" className="drawing-tool" aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")} disabled={disabled}>
          Eraser
        </button>
        <span className="drawing-tools-gap" />
        <button type="button" className="drawing-tool" onClick={undo} disabled={disabled || count === 0}>
          Undo
        </button>
        <button type="button" className="drawing-tool" onClick={clear} disabled={disabled || count === 0}>
          Clear
        </button>
      </div>
    </div>
  );
});
