# OracleAI Predict Style Guide

## Brand Direction
- **Positioning:** AI-powered Web3 prediction platform that combines trust, clarity, and speed.
- **Tone:** Confident, precise, helpful, and action-oriented.
- **Messaging Formula:** Problem -> Proof -> Benefit -> CTA.

## Colors
- **Primary:** `#8C7CFF` (dark mode), `#635BFF` (light mode)
- **Primary Strong:** `#A194FF` (dark mode), `#473BFF` (light mode)
- **Background:** `#090C13` (dark), `#F7FAFC` (light)
- **Surface:** `#111827` (dark), `#FFFFFF` (light)
- **Text:** `#F8FAFC` (dark), `#0F172A` (light)
- **Muted Text:** `#B3C0D2` (dark), `#475569` (light)
- **Border:** `#2B3A51` (dark), `#D8E1EE` (light)

## Typography
- **Headings:** Manrope (`--font-heading`)
- **Body:** Inter (`--font-body`)
- **Style Rules:** Short, high-clarity headlines; compact paragraphs; strong CTA verbs.

## Layout
- **Container:** `min(1140px, calc(100% - 2rem))`
- **Header:** Sticky, translucent blur, visible CTA.
- **Sections:** Consistent vertical rhythm (`3.5rem`+).
- **Cards:** Rounded, bordered, subtle gradient/surface contrast.

## UX Principles
- Mobile-first layout with desktop enhancement.
- Color contrast designed for WCAG-friendly readability.
- Strong CTA hierarchy (`Primary` then `Ghost`).
- Keep forms short, with labels always visible.
- Social proof visible before final CTA.

## Conversion Patterns Included
- Hero with value proposition + dual CTA.
- KPI strip for trust and authority.
- Testimonial carousel.
- Exit-intent style timed newsletter popup.
- Contact + lead capture forms via Formspree.

## SEO Foundation
- Route-level metadata on primary pages.
- Open Graph + Twitter card metadata in root layout.
- JSON-LD schema on homepage.
- `sitemap.xml` + `robots.txt` generated in app routes.

## Integration Placeholders
- **Google Analytics:** set `NEXT_PUBLIC_GA_ID`.
- **Form endpoints:** replace `https://formspree.io/f/your-form-id`.
- **Canonical domain:** update `metadataBase` and sitemap URLs.
