import { expect, it } from "vitest";
import { tabWheelPixels } from "./tabWheel";

const vertical = {
  deltaMode: 0,
  deltaX: 0,
  deltaY: 2.5,
  ctrlKey: false,
  metaKey: false,
};

it.each([
  [vertical, 2.5],
  [{ ...vertical, deltaMode: 1, deltaY: -3 }, -48],
  [{ ...vertical, deltaMode: 2, deltaY: 1 }, 320],
])("translates the wheel's delta unit to pixels", (event, pixels) => {
  expect(tabWheelPixels(event, 320)).toBe(pixels);
});

it.each([
  { ...vertical, deltaX: 8 },
  { ...vertical, ctrlKey: true },
  { ...vertical, metaKey: true },
  { ...vertical, deltaY: Number.NaN },
])("leaves non-scroll and native horizontal gestures alone", (event) => {
  expect(tabWheelPixels(event, 320)).toBe(0);
});
