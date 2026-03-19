import { describe, expect, it } from "vitest";

import { filterVisibleSiteIds, filterVisibleSites, isVisibleSiteId } from "./site-labels";

describe("site visibility helpers", () => {
  it("hides smoke-prefixed site ids", () => {
    expect(isVisibleSiteId("smoke-site")).toBe(false);
    expect(isVisibleSiteId("SMOKE-demo")).toBe(false);
    expect(isVisibleSiteId("39100103")).toBe(true);
  });

  it("filters hidden site ids from arrays", () => {
    expect(filterVisibleSiteIds(["39100103", "smoke-site", "SITE_A"])).toEqual(["39100103", "SITE_A"]);
  });

  it("filters hidden site records from site collections", () => {
    expect(
      filterVisibleSites([
        { site_id: "39100103", hospital_name: "Jeju National University Hospital" },
        { site_id: "smoke-site", hospital_name: "Smoke Hospital" },
      ]),
    ).toEqual([{ site_id: "39100103", hospital_name: "Jeju National University Hospital" }]);
  });
});
