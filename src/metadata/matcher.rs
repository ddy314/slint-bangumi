use std::path::Path;

use crate::domain::{DanmakuMatch, MediaItem};

pub fn keyword_for_media(media: &MediaItem, danmaku: Option<&DanmakuMatch>) -> String {
    if let Some(danmaku) = danmaku {
        let title = danmaku
            .title
            .split(" - ")
            .next()
            .unwrap_or(&danmaku.title)
            .trim();
        if !title.is_empty() {
            return title.to_string();
        }
    }

    clean_file_title(&media.file_name)
}

fn clean_file_title(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(file_name);
    let mut out = String::new();
    let mut bracket_depth = 0;
    for ch in stem.chars() {
        match ch {
            '[' | '【' | '(' | '（' => bracket_depth += 1,
            ']' | '】' | ')' | '）' => bracket_depth = (bracket_depth - 1).max(0),
            '_' | '.' if bracket_depth == 0 => out.push(' '),
            _ if bracket_depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}
