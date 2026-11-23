import { describe, expect, it } from "vitest";
import { filledCount, formToPatch, isFounder, toForm, type Profile } from "./profile";

const p = (o: Partial<Profile> = {}): Profile => ({ display_name: null, age: null, location: null, occupation: null, avatar: null, member_no: null, email: "a@b.c", ...o });

describe("profile", () => {
  it("turns the typed form into a patch; empty clears, age is 13 to 120", () => {
    expect(formToPatch({ display_name: " Asha ", age: "", location: "", occupation: "" })).toEqual({ patch: { display_name: "Asha", age: null, location: null, occupation: null } });
    expect(formToPatch({ ...toForm(null), age: "12" })).toEqual({ error: "Age must be between 13 and 120" });
    expect(formToPatch({ ...toForm(null), age: "121" })).toEqual({ error: "Age must be between 13 and 120" });
    expect(formToPatch({ ...toForm(null), age: "30" })).toMatchObject({ patch: { age: 30 } });
  });
  it("founders are the first 200", () => {
    expect([isFounder(p({ member_no: 1 })), isFounder(p({ member_no: 200 })), isFounder(p({ member_no: 201 })), isFounder(p()), isFounder(null)]).toEqual([true, true, false, false, false]);
  });
  it("counts filled details", () => {
    expect(filledCount(p({ display_name: "A", age: 20 }))).toBe(2);
    expect(filledCount(null)).toBe(0);
  });
});
