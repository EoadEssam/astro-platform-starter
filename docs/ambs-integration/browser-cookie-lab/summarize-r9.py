# يستخرج من نتائج تشغيل r9 ما يثبته كل سيناريو، بلا تفسير. «يبقى» = الكوكي الجديد للدخول B ما زال بعد وصول الرد المتأخر.
import json, sys


def cookies(w):
    return (w.get('body') or {}).get('cookies') or {}


def kept(r):
    before, after = cookies(r['whoBBefore']), cookies(r['whoBAfter'])
    new = [v for v in before.values() if v.startswith('I2-')]
    return bool(new) and new[0] in after.values() and r['whoBAfter']['status'] == 200


def notes(r, tag):
    return [e['note'] for e in r['serverLog'] if e.get('note') and e.get('tag') == tag]


def facts(o):
    r = o['runs']
    f = {}
    a = r['L5_late401_noclear']
    f['L5_new_signin_kept_after_late_401'] = cookies(a['whoAfterLate']) == cookies(a['whoAfterSignin']) and a['whoAfterLate']['status'] == 200
    f['L5_late_401_carried_no_set_cookie'] = all(e.get('setCookie') is None for e in a['serverLog'] if e.get('status') == 401)
    for k in ('L6a_two_tabs_no_coordination', 'L6b_two_tabs_web_locks', 'L6c_two_tabs_cookie_per_signin'):
        f[k + '__new_signin_kept'] = kept(r[k])
    f['L6b_signin_waited_for_lock_ms'] = r['L6b_two_tabs_web_locks']['signinBWaitedMs']
    for k in ('L7a_close_tab_during_signout', 'L7b_close_tab_during_signout_keepalive', 'L8a_crash_tab_during_signout', 'L8b_crash_tab_during_signout_keepalive'):
        if k in r:
            f[k + '__new_signin_kept'] = kept(r[k])
            f[k + '__signout_response'] = notes(r[k], 'so')
    if 'L8_crash' in r:
        f['L8_crash'] = r['L8_crash']
    a = r['L9_ui_timeout_without_abort']
    f['L9_ui_saw_timeout_first'] = a['first'] == 'ui-timeout'
    f['L9_cookie_changed_after_ui_timeout'] = cookies(a['whoLater']) != cookies(a['before']) and a['whoLater']['status'] == 200
    for k in ('L10a_broadcast_only_close', 'L10b_broadcast_only_close_keepalive'):
        f[k + '__saw_done'] = r[k]['b']['sawDone']
        f[k + '__new_signin_kept'] = kept(r[k])
        f[k + '__signout_response'] = notes(r[k], 'so')
    return f


res = {p: facts(json.load(open(p))) for p in sys.argv[1:]}
first = next(iter(res.values()))
print(json.dumps({'per_run': res, 'identical_within_engine': {
    eng: len({json.dumps({k: v for k, v in f.items() if 'waited' not in k}, sort_keys=True) for p, f in res.items() if eng in p}) == 1
    for eng in ('chrome', 'webkit')}}, indent=1, ensure_ascii=False))
