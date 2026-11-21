# يستخرج من نتيجة التشغيل ما يثبته كل سيناريو، بلا تفسير.
import json, sys
def res(w): return (w['body'] or {}).get('resolution')
def ck(w): return (w['body'] or {}).get('cookie')
def facts(r):
    f = {}
    a = r['L1']; f['L1_late_switch_cookie_applied'] = ck(a['afterLate']) not in (None, ck(a['before'])); f['L1_after_late_resolution'] = res(a['afterLate']); f['L1_next_cookie_cleared'] = ck(a['next']) is None
    a = r['L2a']; f['L2a_new_signin_cookie_cleared_by_late_signout'] = ck(a['afterLateSignout']) is None
    a = r['L2b_401_clear']; f['L2b_new_signin_cookie_cleared_by_late_401'] = ck(a['afterLate401']) is None
    a = r['L2c_401_noclear']; f['L2c_new_signin_cookie_kept_when_401_has_no_clear'] = ck(a['afterLate401']) == ck(a['afterNewSignin'])
    a = r['L4a']; f['L4a_abort_before_headers_cookie_unchanged'] = ck(a['after']) == ck(a['before']); f['L4a_server_committed_anyway'] = any(e.get('committed') for e in a['serverLog']); f['L4a_after_resolution'] = res(a['after'])
    a = r['L4b']; f['L4b_abort_after_headers_cookie_applied'] = ck(a['after']) not in (None, ck(a['before']))
    a = r['L3']; f['L3_second_tab_status'] = a['tabB_switch']['status']; f['L3_second_tab_set_cookie'] = any(e.get('setCookie') and e.get('status')==409 for e in a['serverLog']); f['L3_tabB_after_tabA_response'] = res(a['tabB_whoAfter'])
    return f
print(json.dumps({p: facts(json.load(open(p))['runs']) for p in sys.argv[1:]}, indent=1))
