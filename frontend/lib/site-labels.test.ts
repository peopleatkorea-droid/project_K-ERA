import { describe, expect, it } from "vitest";

import { filterVisibleSiteIds, filterVisibleSites, getSiteDisplayName, isVisibleSiteId } from "./site-labels";

describe("site visibility helpers", () => {
  it("hides smoke-prefixed and synthetic http site ids", () => {
    expect(isVisibleSiteId("smoke-site")).toBe(false);
    expect(isVisibleSiteId("SMOKE-demo")).toBe(false);
    expect(isVisibleSiteId("HTTP_SITE")).toBe(false);
    expect(isVisibleSiteId("39100103")).toBe(true);
  });

  it("filters hidden site ids from arrays", () => {
    expect(filterVisibleSiteIds(["39100103", "smoke-site", "HTTP_SITE", "SITE_A"])).toEqual(["39100103", "SITE_A"]);
  });

  it("filters hidden site records from site collections", () => {
    expect(
      filterVisibleSites([
        { site_id: "39100103", hospital_name: "Jeju National University Hospital" },
        { site_id: "smoke-site", hospital_name: "Smoke Hospital" },
        { site_id: "prod-http", hospital_name: "HTTP Hospital" },
      ]),
    ).toEqual([{ site_id: "39100103", hospital_name: "Jeju National University Hospital" }]);
  });

  it("prefers the source institution name over raw site codes", () => {
    expect(
      getSiteDisplayName({
        site_id: "39100103",
        display_name: "39100103",
        hospital_name: "39100103",
        source_institution_name: "Jeju National University Hospital",
      }),
    ).toBe("Jeju National University Hospital");
  });
});
