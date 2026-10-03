import sys
import os
import json
import speech_recognition as sr

def transcribe_segments(manifest_path, lang='pt-BR'):
    if not os.path.exists(manifest_path):
        print(json.dumps({'error': f'Manifest not found: {manifest_path}'}))
        sys.exit(1)

    with open(manifest_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    segment_files = data.get('segments', [])
    language = data.get('language', lang)
    if not language:
        language = 'pt-BR'

    r = sr.Recognizer()
    results = {}

    for item in segment_files:
        seg_id = item['id']
        wav_path = item['path']
        if not os.path.exists(wav_path):
            results[str(seg_id)] = ''
            continue

        try:
            with sr.AudioFile(wav_path) as source:
                audio = r.record(source)
                # Try primary language
                try:
                    text = r.recognize_google(audio, language=language)
                except sr.UnknownValueError:
                    text = ''
                except Exception:
                    # Fallback try generic or english if primary failed
                    try:
                        text = r.recognize_google(audio, language='en-US' if language.startswith('pt') else 'pt-BR')
                    except Exception:
                        text = ''
                results[str(seg_id)] = text.strip()
        except Exception as e:
            results[str(seg_id)] = ''

    print(json.dumps({'success': True, 'transcriptions': results}, ensure_ascii=False))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: transcribe.py <manifest_json_path> [language]'}))
        sys.exit(1)
    
    manifest = sys.argv[1]
    language_code = sys.argv[2] if len(sys.argv) > 2 else 'pt-BR'
    transcribe_segments(manifest, language_code)
