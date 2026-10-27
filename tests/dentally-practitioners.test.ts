import { describe, expect, it } from "vitest";
import { mergeDoctors, practitionersToDoctors } from "@/lib/dentally/practitioners";

describe("practitionersToDoctors", () => {
  it("builds names and emails, skipping rows without an id or a name", () => {
    expect(
      practitionersToDoctors([
        { id: 1, first_name: "Dr", last_name: "Ali", email_address: "ali@example.com" },
        { id: 2, name: "Dr Bea" },
        { first_name: "No", last_name: "Id" },
        { id: 3 },
      ]),
    ).toEqual([{ id: "1", name: "Dr Ali", email: "ali@example.com" }, { id: "2", name: "Dr Bea" }]);
  });
});

describe("mergeDoctors", () => {
  it("adds only new ids and never overwrites existing entries", () => {
    const { doctors, added } = mergeDoctors([{ id: "1", name: "Dr Ali Khan", email: "a@x.com" }], [{ id: "1", name: "Different" }, { id: "2", name: "Dr Bea" }, { id: "2", name: "Dup" }]);
    expect(added).toBe(1);
    expect(doctors).toEqual([{ id: "1", name: "Dr Ali Khan", email: "a@x.com" }, { id: "2", name: "Dr Bea" }]);
  });
  it("adds nothing when everything is known", () => {
    expect(mergeDoctors([{ id: "1", name: "A" }], [{ id: "1", name: "A" }]).added).toBe(0);
  });
});
