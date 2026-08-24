import { expect, test } from "bun:test";
import { EditBufferRenderable, TextareaRenderable } from "@opentui/core";

// App.tsx cannot take the value from onContentChange: OpenTUI declares the
// handler as `(value: string) => void` but calls it with `{}`, which is what
// made `input()` a bare object and crashed the first keystroke on
// `v.startsWith("/")`. We read the text off the renderable instead, so these
// are the members the input box actually depends on. If a future OpenTUI
// starts passing the string, this test still passes — check the handler
// signature then and simplify App.tsx.

test("textarea inherits the members App.tsx reads the input from", () => {
  expect(TextareaRenderable.prototype).toBeInstanceOf(EditBufferRenderable);

  const plainText = Object.getOwnPropertyDescriptor(EditBufferRenderable.prototype, "plainText");
  expect(plainText?.get).toBeTypeOf("function");

  // Used to clear the box on submit; setText does not fire onContentChange.
  expect(EditBufferRenderable.prototype.setText).toBeTypeOf("function");
});
