import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { legalDocuments, type LegalDocument } from "./legalDocuments.js";
import "./legal.css";

export function LegalPage({ document }: { document: LegalDocument }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { hash } = useLocation();

  useEffect(() => {
    documentTitle(document.title);
    const section = hash ? window.document.getElementById(hash.slice(1)) : null;
    if (section) {
      section.focus({ preventScroll: true });
      section.scrollIntoView();
      return;
    }
    titleRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [document.path, document.title, hash]);

  return (
    <div className="legal-shell">
      <a className="legal-skip" href="#legal-content">Skip to document</a>
      <header className="legal-header">
        <Link className="legal-header__brand" to="/" aria-label="SABG arena home">SABG</Link>
        <nav className="legal-header__nav" aria-label="Legal documents">
          {legalDocuments.map((item) => (
            <Link
              key={item.path}
              className="legal-header__link"
              to={item.path}
              aria-current={item.path === document.path ? "page" : undefined}
            >
              {item.navLabel}
            </Link>
          ))}
        </nav>
        <Link className="legal-header__back" to="/">Enter arena</Link>
      </header>

      <main className="legal-frame" id="legal-content">
        <article className="legal-document">
          <header className="legal-document__intro">
            <div className="legal-document__meta">
              <span>Last updated {document.lastUpdated}</span>
            </div>
            <h1 ref={titleRef} tabIndex={-1}>
              {document.title}
            </h1>
            <p className="legal-document__summary">{document.summary}</p>
          </header>

          <div className="legal-document__layout">
            <nav className="legal-toc" aria-label={`${document.title} contents`}>
              <strong>On this page</strong>
              <ol>
                {document.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.title.replace(/^\d+\.\s/u, "")}</a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="legal-copy">
              {document.sections.map((section) => (
                <section id={section.id} key={section.id} tabIndex={-1}>
                  <h2>{section.title}</h2>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.bullets && (
                    <ul>
                      {section.bullets.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </div>

          <footer className="legal-document__footer">
            <div>
              <strong>Questions?</strong>
              <p>
                Legal and privacy: <a href="mailto:legal@sabg.fun">legal@sabg.fun</a><br />
                Product and settlement support: <a href="mailto:support@sabg.fun">support@sabg.fun</a>
              </p>
            </div>
            <nav aria-label="Related legal documents">
              {legalDocuments
                .filter((item) => item.path !== document.path)
                .map((item) => (
                  <Link key={item.path} to={item.path}>{item.title}</Link>
                ))}
              <Link to="/">Back to arena</Link>
            </nav>
          </footer>
        </article>
      </main>
    </div>
  );
}

function documentTitle(title: string): void {
  window.document.title = `${title} | SABG`;
}
