"""Optional integration smoke: pip install playwright; start npm run preview first.
Uses deterministic YouTube fixtures, never a real API key.
Run: BROWSER_EXECUTABLE=/usr/bin/chromium python tests/browser_smoke.py
"""
import json, os, tempfile
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    launch = {'headless': True}
    if os.environ.get('BROWSER_EXECUTABLE'):
        launch['executable_path'] = os.environ['BROWSER_EXECUTABLE']
    browser = p.chromium.launch(**launch)
    context = browser.new_context(viewport={'width':1440,'height':1000}, reduced_motion='reduce', accept_downloads=True)
    page = context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    screenshots=Path(os.environ.get('SCREENSHOT_DIR', tempfile.mkdtemp(prefix='playlist-clock-qa-')))
    screenshots.mkdir(parents=True, exist_ok=True)
    behavior={'quota':False}
    def api(route):
        url=urlparse(route.request.url); query=parse_qs(url.query)
        if behavior['quota']:
            route.fulfill(status=403,json={'error':{'errors':[{'reason':'quotaExceeded'}]}});return
        if url.path.endswith('/playlists'):
            payload={'items':[{'id':id,'snippet':{'title':'Learning <script>sample</script>'}} for id in query['id'][0].split(',')]}
        elif url.path.endswith('/playlistItems'):
            payload={'items':[{'contentDetails':{'videoId':id},'snippet':{'position':i,'title':'Unavailable'}} for i,id in enumerate(['abcdefghijk','lmnopqrstuv','missing1234'])]}
        else:
            payload={'items':[{'id':id,'snippet':{'title':'Video '+id,'channelTitle':'Test channel','liveBroadcastContent':'none'},'contentDetails':{'duration':'PT10M' if id=='abcdefghijk' else 'PT20M'}} for id in query['id'][0].split(',') if id!='missing1234']}
        route.fulfill(json=payload)
    page.route('https://www.googleapis.com/**',api)
    page.goto(os.environ.get('BASE_URL','http://localhost:4173/'))
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    page.get_by_role('button',name='Switch to light mode').click()
    page.reload()
    expect(page.locator('html')).to_have_attribute('data-theme','light')
    page.get_by_role('button',name='Switch to dark mode').click()
    page.locator('#demo').click()
    expect(page.locator('#video-count')).to_have_text('12')
    expect(page.locator('#result-badge')).to_contain_text('sample')
    page.locator('[data-speed="2"]').click()
    expect(page.locator('#savings')).to_contain_text('50%')
    page.locator('#progress').fill('12')
    expect(page.locator('#finish-date')).to_have_text('All caught up.')
    for box in page.locator('input[name="day"]').all(): box.uncheck()
    expect(page.locator('#planner-status')).to_contain_text('Choose at least one')
    page.locator('input[name="day"][value="1"]').check()
    page.locator('#progress').fill('0')
    page.locator('#advanced summary').click()
    page.locator('input[name="mode"][value="range"]').check()
    page.locator('#range-start').fill('2');page.locator('#range-end').fill('3')
    expect(page.locator('#video-count')).to_have_text('2')
    page.locator('#range-end').fill('1')
    expect(page.locator('#status')).to_contain_text('greater than or equal')
    expect(page.locator('#results')).to_be_hidden()
    page.locator('input[name="mode"][value="remaining"]').check()
    page.locator('#watched').fill('10')
    expect(page.locator('#video-count')).to_have_text('2')
    page.locator('#include-current').check()
    expect(page.locator('#video-count')).to_have_text('3')
    page.locator('input[name="mode"][value="full"]').check()
    page.locator('#sources').fill('https://www.youtube.com/playlist?list=PLabcdefgh123')
    page.locator('#calculate').click()
    expect(page.locator('#status')).to_contain_text('A YouTube API key is needed')
    page.locator('#api-key').fill('TEST_KEY_ONLY')
    page.locator('#sources').fill('https://www.youtube.com/playlist?list=PLabcdefgh123\nhttps://youtu.be/abcdefghijk')
    page.locator('#calculate').click()
    expect(page.locator('#video-count')).to_have_text('3')
    expect(page.locator('#original-duration')).to_have_text('40m')
    expect(page.locator('#total-time')).to_have_text('20m')
    expect(page.locator('#result-note')).to_contain_text('1 unavailable entry')
    assert page.locator('#source-breakdown script').count()==0
    page.locator('.video-details summary').click()
    expect(page.locator('.video-row')).to_have_count(4)
    with page.expect_download() as event:
        page.locator('#export').click()
    download=event.value
    path=Path(tempfile.gettempdir())/'playlist-clock-smoke.xlsx'
    download.save_as(path)
    assert path.read_bytes()[:2]==b'PK', 'Expected an XLSX zip container'
    assert path.stat().st_size>1000
    behavior['quota']=True
    page.locator('#calculate').click()
    expect(page.locator('#status')).to_contain_text('quota')
    expect(page.locator('#results')).to_be_hidden()
    behavior['quota']=False
    page.locator('#demo').click()
    for width in [320,375,390,768,1440]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow at {width}'
    page.set_viewport_size({'width':390,'height':844})
    page.locator('#advanced summary').click()
    page.screenshot(path=str(screenshots/'mobile-results.png'),full_page=True)
    page.get_by_role('button',name='Switch to light mode').click()
    page.screenshot(path=str(screenshots/'mobile-light.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1000})
    page.screenshot(path=str(screenshots/'desktop-light.png'),full_page=True)
    assert not errors, errors
    print('PASS: themes, sample, speeds, planner, ranges, remaining, missing key, mocked API, XSS-safe titles, quota, XLSX download, responsive widths, zero browser errors.')
    browser.close()
