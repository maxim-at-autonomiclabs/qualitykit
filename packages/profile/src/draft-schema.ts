/**
 * JSON Schema-ish description embedded in model prompts.
 * Keep in sync with Site Profile field value shapes.
 */
export const PROFILE_DRAFT_SCHEMA_DESCRIPTION = `{
  "brandIdentity": { "name": string, "positioning": string, "category"?: string },
  "icp": { "audience": string, "industries": string[], "roles": string[], "painPoints": string[] },
  "products": [ { "name": string, "description"?: string } ],
  "brandVoice": { "tone": string, "terminology": string[], "standards": string[] },
  "existingPages": [ { "path": string, "topic": string, "intent"?: string, "title"?: string } ],
  "keywordRelevance": [ { "query": string, "score": number, "band": "high"|"adjacent"|"irrelevant", "reason": string } ],
  "competitors": [ { "name": string, "positioning"?: string } ],
  "conversionGoals": { "primary": string, "secondary": string[] }
}`;

export const PROFILE_REFRESH_SYSTEM = `You maintain a website Site Profile for SEO growth.
Return ONLY valid JSON. Keys are Site Profile field ids.
Only include fields you were asked to refresh.
Do not invent competitors, stats, or customers without evidence.
Search impressions must not redefine ICP — classify queries under keywordRelevance instead.
Mark confidence implicitly by being conservative when evidence is thin.
Use this value shape per field:
${PROFILE_DRAFT_SCHEMA_DESCRIPTION}`;
