import { beforeEach, describe, expect, it } from "vitest";

import {
  cacheSiteRecords,
  mergeSiteRecordMetadata,
  mergeSitesWithCachedMetadata,
  siteRecordNeedsLabelHydration,
  sitesNeedLabelHydration,
} from "../app/home-page-auth-shared";

describe("home page site metadata helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("prefers fresh institution metadata over stale placeholder site labels", () => {
    expect(
      mergeSiteRecordMetadata(
        {
          site_id: "39100103",
          display_name: "39100103",
          hospital_name: "39100103",
          source_institution_name: "제주대학교병원",
        },
        {
          site_id: "39100103",
          display_name: "39100103",
          hospital_name: "39100103",
        },
      ),
    ).toEqual({
      site_id: "39100103",
      display_name: "제주대학교병원",
      hospital_name: "제주대학교병원",
      source_institution_name: "제주대학교병원",
    });
  });

  it("keeps an alias while upgrading raw HIRA labels to the institution name", () => {
    expect(
      mergeSiteRecordMetadata(
        {
          site_id: "39100103",
          display_name: "JNUH",
          hospital_name: "39100103",
          source_institution_name: "제주대학교병원",
        },
        {
          site_id: "39100103",
          display_name: "39100103",
          hospital_name: "39100103",
        },
      ),
    ).toEqual({
      site_id: "39100103",
      display_name: "JNUH",
      hospital_name: "제주대학교병원",
      source_institution_name: "제주대학교병원",
    });
  });

  it("preserves cached institution names when a later optimistic site payload only has raw codes", () => {
    cacheSiteRecords([
      {
        site_id: "39100103",
        display_name: "39100103",
        hospital_name: "39100103",
        source_institution_name: "제주대학교병원",
      },
    ]);

    expect(
      mergeSitesWithCachedMetadata([
        {
          site_id: "39100103",
          display_name: "39100103",
          hospital_name: "39100103",
        },
      ]),
    ).toEqual([
      {
        site_id: "39100103",
        display_name: "제주대학교병원",
        hospital_name: "제주대학교병원",
        source_institution_name: "제주대학교병원",
      },
    ]);
  });

  it("flags raw HIRA-coded site labels as needing hydration", () => {
    expect(
      siteRecordNeedsLabelHydration({
        site_id: "39100103",
        display_name: "39100103",
        hospital_name: "39100103",
      }),
    ).toBe(true);
    expect(
      sitesNeedLabelHydration([
        {
          site_id: "39100103",
          display_name: "39100103",
          hospital_name: "39100103",
        },
      ]),
    ).toBe(true);
  });

  it("treats institution-backed site labels as already hydrated", () => {
    expect(
      siteRecordNeedsLabelHydration({
        site_id: "39100103",
        display_name: "39100103",
        hospital_name: "39100103",
        source_institution_name: "제주대학교병원",
      }),
    ).toBe(false);
  });
});
