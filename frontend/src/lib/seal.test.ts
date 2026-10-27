import fixture from "../../../fixtures/sealed-sample.json";
import { unseal } from "./seal";

it("decodes the generator's fixture", async () => {
  expect(await unseal(fixture.sealed, fixture.date)).toEqual(fixture.payload);
});

it("garbles with the wrong date", async () => {
  await expect(unseal(fixture.sealed, "2026-10-29")).rejects.toThrow();
});
