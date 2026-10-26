import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  clinicConfigSchema,
  fieldErrors,
  forgotPasswordSchema,
  formDataToObject,
  inviteSchema,
  loginSchema,
  manualCancellationSchema,
  memberRoleSchema,
  memberTargetSchema,
  normaliseDoctors,
  normalizeUkPhone,
  pipelineTargetSchema,
  publicJoinSchema,
  safeNextPath,
  setPasswordSchema,
  waitlistPatientFormSchema,
} from "@/lib/validation";

describe("normalizeUkPhone", () => {
  it.each([
    ["07700 900001", "+447700900001"],
    ["(07700) 900-001", "+447700900001"],
    ["+44 7700 900001", "+447700900001"],
    ["0044 7700 900001", "+447700900001"],
    ["447700900001", "+447700900001"],
    ["+1 415 555 0100", "+14155550100"],
  ])("normalises %s", (input, expected) => {
    expect(normalizeUkPhone(input)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "abc", "12345", "07700 90000x", "+", "1".repeat(16)])(
    "rejects %j",
    (input) => {
      expect(normalizeUkPhone(input as string | null | undefined)).toBeNull();
    },
  );
});

describe("safeNextPath", () => {
  it("keeps same-origin paths, including query strings", () => {
    expect(safeNextPath("/crm")).toBe("/crm");
    expect(safeNextPath("/crm/waitlist?x=1")).toBe("/crm/waitlist?x=1");
  });

  it("falls back for empty, missing or non-string input", () => {
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "evil.example/path",
    "/ok\r\nSet-Cookie: a=b",
    "/ok\u0000",
  ])("blocks %j", (input) => {
    expect(safeNextPath(input)).toBe("/dashboard");
  });

  it("uses a custom fallback", () => {
    expect(safeNextPath("//x", "/crm")).toBe("/crm");
  });
});

describe("formDataToObject", () => {
  it("collects single and repeated keys and skips React internals", () => {
    const fd = new FormData();
    fd.append("name", "Alice");
    fd.append("days", "mon");
    fd.append("days", "tue");
    fd.append("days", "wed");
    fd.append("$ACTION_ID_abc", "x");
    expect(formDataToObject(fd)).toEqual({ name: "Alice", days: ["mon", "tue", "wed"] });
  });

  it("returns an empty object for empty form data", () => {
    expect(formDataToObject(new FormData())).toEqual({});
  });
});

describe("loginSchema", () => {
  it("accepts a valid login and trims the email", () => {
    const r = loginSchema.safeParse({ email: "  a@clinic.co.uk ", password: "x" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("a@clinic.co.uk");
  });

  it("reports an empty email and password", () => {
    const r = loginSchema.safeParse({ email: "", password: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error)).toEqual({
        email: "Enter your email address.",
        password: "Enter your password.",
      });
    }
  });

  it("rejects a malformed email", () => {
    const r = loginSchema.safeParse({ email: "not-an-email", password: "x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).email).toBe("Enter a valid email address.");
  });

  it("rejects wrong types", () => {
    expect(loginSchema.safeParse({ email: 5, password: [] }).success).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("needs a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "a@" }).success).toBe(false);
  });
});

describe("setPasswordSchema", () => {
  const ok = "a".repeat(PASSWORD_MIN);

  it("accepts the minimum and maximum lengths", () => {
    expect(setPasswordSchema.safeParse({ password: ok, confirm: ok }).success).toBe(true);
    const max = "b".repeat(PASSWORD_MAX);
    expect(setPasswordSchema.safeParse({ password: max, confirm: max }).success).toBe(true);
  });

  it("rejects too short and too long", () => {
    const short = "a".repeat(PASSWORD_MIN - 1);
    const long = "a".repeat(PASSWORD_MAX + 1);
    expect(setPasswordSchema.safeParse({ password: short, confirm: short }).success).toBe(false);
    expect(setPasswordSchema.safeParse({ password: long, confirm: long }).success).toBe(false);
  });

  it("puts the mismatch error on the confirm field", () => {
    const r = setPasswordSchema.safeParse({ password: ok, confirm: ok + "x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).confirm).toBe("The two passwords do not match.");
  });
});

describe("Phase 2 schemas", () => {
  const goodConfig = {
    contact_email: "reception@clinic.co.uk",
    price_cleaning: "60",
    price_consultation: "50",
    price_filling: "120",
    price_extraction: "150",
    price_crown: "600",
    price_implant: "2000",
    price_whitening: "300",
    price_default: "99",
    doctors: JSON.stringify([{ name: "Dr Patel" }]),
    engine_enabled: "on",
    offer_channels: ["sms", "email"],
    offer_expiry_minutes: "30",
    offer_strategy: "sequential",
    batch_size: "3",
    max_offers_per_slot: "5",
    min_lead_minutes: "60",
    max_horizon_hours: "72",
    approval_window_minutes: "60",
    quiet_hours_start: "20:00",
    quiet_hours_end: "08:00",
  };

  describe("waitlistPatientFormSchema", () => {
    it("normalises a valid patient", () => {
      const r = waitlistPatientFormSchema.safeParse({
        patient_name: " Ann Lee ",
        phone: "07700 900123",
        email: "",
        preferred_procedures: "cleaning",
        preferred_days: ["Monday", "Tuesday"],
        max_notice_hours: "24",
        existing_patient: "on",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.patient_name).toBe("Ann Lee");
        expect(r.data.phone).toBe("+447700900123");
        expect(r.data.email).toBeUndefined();
        expect(r.data.preferred_procedures).toEqual(["cleaning"]);
        expect(r.data.preferred_times).toEqual([]);
        expect(r.data.existing_patient).toBe(true);
      }
    });

    it("needs a phone or an email", () => {
      const r = waitlistPatientFormSchema.safeParse({ patient_name: "Ann", max_notice_hours: "0" });
      expect(r.success).toBe(false);
    });

    it("rejects a bad phone, a bad email, a missing name and out-of-range notice", () => {
      expect(waitlistPatientFormSchema.safeParse({ patient_name: "A", phone: "123", max_notice_hours: "0" }).success).toBe(false);
      expect(waitlistPatientFormSchema.safeParse({ patient_name: "A", email: "nope", max_notice_hours: "0" }).success).toBe(false);
      expect(waitlistPatientFormSchema.safeParse({ patient_name: " ", email: "a@b.co.uk", max_notice_hours: "0" }).success).toBe(false);
      expect(waitlistPatientFormSchema.safeParse({ patient_name: "A", email: "a@b.co.uk", max_notice_hours: "337" }).success).toBe(false);
      expect(waitlistPatientFormSchema.safeParse({ patient_name: "A", email: "a@b.co.uk", max_notice_hours: "-1" }).success).toBe(false);
    });
  });

  describe("publicJoinSchema", () => {
    const good = {
      patient_name: "Ann",
      phone: "07700900123",
      email: "Ann@Example.com",
      max_notice_hours: "24",
      consent: "on",
    };

    it("accepts a complete sign-up", () => {
      const r = publicJoinSchema.safeParse(good);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.email).toBe("ann@example.com");
    });

    it("requires mobile, email and consent", () => {
      expect(publicJoinSchema.safeParse({ ...good, phone: "" }).success).toBe(false);
      expect(publicJoinSchema.safeParse({ ...good, email: "" }).success).toBe(false);
      expect(publicJoinSchema.safeParse({ ...good, consent: undefined }).success).toBe(false);
    });

    it("only allows the notice options on offer", () => {
      expect(publicJoinSchema.safeParse({ ...good, max_notice_hours: "5" }).success).toBe(false);
      expect(publicJoinSchema.safeParse({ ...good, max_notice_hours: "0" }).success).toBe(true);
      // An unselected dropdown posts "" and must not silently become "same day".
      expect(publicJoinSchema.safeParse({ ...good, max_notice_hours: "" }).success).toBe(false);
      expect(publicJoinSchema.safeParse({ ...good, max_notice_hours: undefined }).success).toBe(false);
    });
  });

  describe("clinicConfigSchema", () => {
    it("accepts valid settings and coerces numbers", () => {
      const r = clinicConfigSchema.safeParse(goodConfig);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.price_crown).toBe(600);
        expect(r.data.engine_enabled).toBe(true);
        expect(r.data.shadow_mode).toBe(false);
        expect(r.data.doctors).toHaveLength(1);
      }
    });

    it("needs at least one channel and valid quiet hours", () => {
      expect(clinicConfigSchema.safeParse({ ...goodConfig, offer_channels: [] }).success).toBe(false);
      expect(clinicConfigSchema.safeParse({ ...goodConfig, quiet_hours_start: "8pm" }).success).toBe(false);
      expect(clinicConfigSchema.safeParse({ ...goodConfig, quiet_hours_end: "24:00" }).success).toBe(false);
    });

    it("rejects negative or fractional prices and broken doctor JSON", () => {
      expect(clinicConfigSchema.safeParse({ ...goodConfig, price_cleaning: "-5" }).success).toBe(false);
      expect(clinicConfigSchema.safeParse({ ...goodConfig, price_cleaning: "9.5" }).success).toBe(false);
      expect(clinicConfigSchema.safeParse({ ...goodConfig, doctors: "{not json" }).success).toBe(false);
    });
  });

  describe("normaliseDoctors", () => {
    it("builds unique slug ids", () => {
      const out = normaliseDoctors([{ name: "Dr. Sam Patel" }, { name: "Dr Sam Patel", email: "s@c.co.uk" }, { name: "###", id: "" }]);
      expect(out.map((d) => d.id)).toEqual(["dr-sam-patel", "dr-sam-patel-2", "dentist"]);
      expect(out[1]?.email).toBe("s@c.co.uk");
    });

    it("keeps an existing id", () => {
      expect(normaliseDoctors([{ id: "keep-me", name: "New Name" }])[0]?.id).toBe("keep-me");
    });
  });

  describe("manualCancellationSchema", () => {
    it("accepts a valid slot and treats blanks as missing", () => {
      const r = manualCancellationSchema.safeParse({
        slot_date: "2027-02-01",
        slot_time: "09:30",
        slot_duration_minutes: "30",
        procedure_type: "",
        doctor_id: "",
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.procedure_type).toBeUndefined();
    });

    it("rejects missing date, time, odd durations and unknown procedures", () => {
      const good = { slot_date: "2027-02-01", slot_time: "09:30", slot_duration_minutes: "30" };
      expect(manualCancellationSchema.safeParse({ ...good, slot_date: "" }).success).toBe(false);
      expect(manualCancellationSchema.safeParse({ ...good, slot_time: "9:30" }).success).toBe(false);
      expect(manualCancellationSchema.safeParse({ ...good, slot_duration_minutes: "0" }).success).toBe(false);
      expect(manualCancellationSchema.safeParse({ ...good, procedure_type: "magic" }).success).toBe(false);
    });
  });

  describe("team schemas", () => {
    it("validates invite, role change and targets", () => {
      expect(inviteSchema.safeParse({ email: "a@b.co.uk", role: "staff" }).success).toBe(true);
      expect(inviteSchema.safeParse({ email: "a@b.co.uk", role: "owner" }).success).toBe(false);
      expect(memberRoleSchema.safeParse({ user_id: "not-a-uuid", role: "admin" }).success).toBe(false);
      expect(memberTargetSchema.safeParse({ user_id: "7d6a0c50-1b0c-4d5e-8f4a-0a1b2c3d4e5f" }).success).toBe(true);
      expect(pipelineTargetSchema.safeParse({ pipeline_id: "7d6a0c50-1b0c-4d5e-8f4a-0a1b2c3d4e5f" }).success).toBe(true);
    });
  });
});
