import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OFFER_EMAIL_VERSION, OFFER_SMS_VERSION, templateVersionFor } from "@/lib/template-versions";
import { pipelineTargetSchema } from "@/lib/validation";

const root = path.resolve(import.meta.dirname, "..");
const ID = "11111111-1111-4111-8111-111111111111";

describe("template versions", () => {
  it("labels follow the offer-<channel>-vN pattern", () => {
    expect(OFFER_EMAIL_VERSION).toBe("offer-email-v1");
    expect(OFFER_SMS_VERSION).toBe("offer-sms-v1");
  });

  it("builds a label from the channels actually used", () => {
    expect(templateVersionFor(["email"])).toBe("offer-email-v1");
    expect(templateVersionFor(["sms"])).toBe("offer-sms-v1");
    expect(templateVersionFor(["sms", "email"])).toBe("offer-email-v1,offer-sms-v1");
    expect(templateVersionFor([])).toBeNull();
  });
});

describe("approval 'via' field", () => {
  it("accepts only 'email'; anything else is ignored (counts as the CRM board)", () => {
    expect(pipelineTargetSchema.parse({ pipeline_id: ID, via: "email" }).via).toBe("email");
    expect(pipelineTargetSchema.parse({ pipeline_id: ID }).via).toBeUndefined();
    expect(pipelineTargetSchema.parse({ pipeline_id: ID, via: "slack" }).via).toBeUndefined();
  });

  it("only the /approve email page sends via=email", () => {
    const approvePage = readFileSync(path.join(root, "app/(app)/approve/[token]/page.tsx"), "utf8");
    expect(approvePage).toMatch(/action=\{approvePipeline\}[^>]*via="email"/);
    const board = readFileSync(path.join(root, "app/(app)/crm/card-actions.tsx"), "utf8");
    expect(board).not.toContain('via="email"');
  });
});
