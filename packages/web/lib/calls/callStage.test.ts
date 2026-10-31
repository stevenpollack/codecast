// A door showing the call's chat opens the stage on its thread, whether the
// stage mounts for it (it takes the request once) or is already up (the
// desktop's call window, shrunk and expanded again: it hears the request).
import { expect, test } from "bun:test";
import { onCallThreadRequest, requestCallThread, takeCallThreadRequest } from "./callStage";

test("a stage mounting takes the thread request once", () => {
  requestCallThread();
  expect(takeCallThreadRequest()).toBe(true);
  expect(takeCallThreadRequest()).toBe(false);
});

test("a stage already up hears the request as it is made, until it unmounts", () => {
  let heard = 0;
  const off = onCallThreadRequest(() => {
    heard++;
    takeCallThreadRequest();
  });
  requestCallThread();
  expect(heard).toBe(1);
  expect(takeCallThreadRequest()).toBe(false);
  off();
  requestCallThread();
  expect(heard).toBe(1);
  takeCallThreadRequest();
});
