import { Writable } from "node:stream";

export function capture() {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk);
      callback();
    },
  });
  return { stream, read: () => output };
}
