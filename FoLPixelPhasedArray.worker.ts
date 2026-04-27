import { buildFoLPixelPhasedArray, type PixelPhasedArrayConfig } from "./FoLPixelPhasedArray";

type RequestMsg = {
  id: number;
  config: PixelPhasedArrayConfig;
};

type ResponseMsg = {
  id: number;
  ok: true;
  result: ReturnType<typeof buildFoLPixelPhasedArray>;
} | {
  id: number;
  ok: false;
  error: string;
};

self.onmessage = (ev: MessageEvent<RequestMsg>) => {
  const { id, config } = ev.data;
  try {
    const result = buildFoLPixelPhasedArray(config);
    const msg: ResponseMsg = { id, ok: true, result };
    (self as unknown as Worker).postMessage(msg, [result.vesicaeBuffer.buffer]);
  } catch (err: any) {
    const msg: ResponseMsg = { id, ok: false, error: String(err?.message || err || "unknown worker error") };
    (self as unknown as Worker).postMessage(msg);
  }
};

