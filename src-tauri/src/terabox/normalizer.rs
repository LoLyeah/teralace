use regex::Regex;
use std::sync::LazyLock;
use url::Url;

/// Comprehensive patterns covering all 50+ TeraBox domains and mirrors
static DOMAIN_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        // Primary and regional domains
        Regex::new(r"terabox\.(com|app|fun|best|ap|club|click|me|site|pro|xyz)").unwrap(),
        Regex::new(r"terabox(app|link|linke|share|sharefile|url|free|mod)\.(com|app)").unwrap(),
        // Share link domains
        Regex::new(r"terashare(link|file|us|drive)\.com").unwrap(),
        Regex::new(r"terafileshare\.com").unwrap(),
        // 1024 variations
        Regex::new(r"(tera1024box|1024tera|1024terabox|1024-terabox|1024box)\.(com|co)").unwrap(),
        // 4fun variations
        Regex::new(r"4funbox\.(com|co|in)").unwrap(),
        // Mirror and legacy domains
        Regex::new(r"(mirrobox|nephobox|freeterabox|momerybox|tibibox|gibibox|pebibox|fancybox|dubox|bestclouddrive)\.(com|in)").unwrap(),
        Regex::new(r"(playduo\.link|theteraboxmod\.app|teraboxdownloader\.com|teradownloader\.com)").unwrap(),
    ]
});

/// Surl extraction regex patterns
static SHORTURL_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        // Standard /s/1xxxx or /s/xxxx
        Regex::new(r"/s/1([a-zA-Z0-9_-]+)").unwrap(),
        Regex::new(r"/s/([a-zA-Z0-9_-]+)").unwrap(),
        // Query param surl=xxxx or surl=1xxxx
        Regex::new(r"[?&]surl=1?([a-zA-Z0-9_-]+)").unwrap(),
        // Wap share link
        Regex::new(r"share/filelist\?.*surl=1?([a-zA-Z0-9_-]+)").unwrap(),
    ]
});

static SHORTURL_RAW: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9_-]{10,32}$").unwrap());

/// Checks if a string contains any recognized TeraBox domain
pub fn is_terabox_url(url: &str) -> bool {
    DOMAIN_PATTERNS.iter().any(|pattern| pattern.is_match(url))
}

/// Extracts a clean TeraBox share URL and the normalized surl identifier
pub fn normalize_terabox_url(input: &str) -> Option<(String, String)> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Direct surl token check
    if SHORTURL_RAW.is_match(trimmed) {
        let surl = trimmed.to_string();
        let canonical_url = format!("https://www.terabox.app/s/1{}", surl.trim_start_matches('1'));
        return Some((canonical_url, surl));
    }

    // Try parsing as a URL
    for pattern in SHORTURL_PATTERNS.iter() {
        if let Some(caps) = pattern.captures(trimmed) {
            if let Some(m) = caps.get(1) {
                let surl = m.as_str().to_string();
                let clean_surl = if surl.starts_with('1') {
                    surl
                } else {
                    format!("1{}", surl)
                };
                let canonical_url = format!("https://www.terabox.app/s/{}", clean_surl);
                return Some((canonical_url, clean_surl));
            }
        }
    }

    // Check if it matches any terabox domain even if regex didn't extract surl directly
    if is_terabox_url(trimmed) {
        if let Ok(parsed) = Url::parse(trimmed) {
            if let Some(segments) = parsed.path_segments() {
                let parts: Vec<&str> = segments.collect();
                if let Some(last) = parts.last() {
                    if !last.is_empty() && last.len() >= 8 {
                        let surl = last.to_string();
                        return Some((trimmed.to_string(), surl));
                    }
                }
            }
        }
        return Some((trimmed.to_string(), String::new()));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_domain_patterns() {
        assert!(is_terabox_url("https://1024terabox.com/s/1abcdEFGH123"));
        assert!(is_terabox_url("https://terasharelink.com/s/1xyz987"));
        assert!(is_terabox_url("https://nephobox.com/s/1test"));
        assert!(!is_terabox_url("https://google.com"));
    }

    #[test]
    fn test_extract_surl() {
        let (url, surl) = normalize_terabox_url("https://terabox.com/s/1DcGWQPuMVDgkXrFhP7AlcQ").unwrap();
        assert_eq!(surl, "1DcGWQPuMVDgkXrFhP7AlcQ");
        assert!(url.contains("1DcGWQPuMVDgkXrFhP7AlcQ"));
    }
}
