"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function BlogPage() {
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const posts = [1, 2, 3, 4, 5, 6].map((i) => ({
    tag: tr(`blogPage.posts.${i}.tag`, "Growth"),
    title: tr(`blogPage.posts.${i}.title`, "Article"),
    excerpt: tr(`blogPage.posts.${i}.excerpt`, "Article excerpt"),
  }));
  return (
    <section className="section">
      <div className="container">
        <p className="eyebrow">{tr("blogPage.eyebrow", "Insights")}</p>
        <h1>{tr("blogPage.title", "Growth, UX, and AI strategy for Web3 teams.")}</h1>
        <p>{tr("blogPage.subtitle", "Fresh playbooks to help your product convert better and retain users longer.")}</p>

        <div className="grid-3 mt-6">
          {posts.map((post) => (
            <article className="card" key={post.title}>
              <p className="eyebrow">{post.tag}</p>
              <h3>{post.title}</h3>
              <p>{post.excerpt}</p>
              <Link href="/contact">{tr("blogPage.readMore", "Read more ->")}</Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
