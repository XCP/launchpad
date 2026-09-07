import type { MetadataRoute } from "next";
import { METADATA_ORIGIN } from "@/lib/metadata";

/**
 * Everything is crawlable except the route handlers, which serve images and
 * JSON that already have canonical page URLs. The sitemap carries every
 * locale of every page, so this is where a crawler learns they exist.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: `${METADATA_ORIGIN}/sitemap.xml`,
  };
}
