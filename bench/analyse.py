import json, collections
rows = [json.loads(l) for l in open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'results.jsonl'))]
NEW = ['letter','invoice','tidy','website','dedupe','dates','minutes','budget','phone','report']
MODELS = ['deepseek/deepseek-v4-flash-0731', 'z-ai/glm-5.3-flash']
# What each job asks for (fixed, decided before the results).
TAGS = {
 'letter':  {'files_out': 1, 'arithmetic': 0, 'dates': 1, 'exact_edit': 0, 'messy_input': 0, 'many_files': 0, 'hidden_rule': 0},
 'invoice': {'files_out': 1, 'arithmetic': 1, 'dates': 0, 'exact_edit': 0, 'messy_input': 1, 'many_files': 0, 'hidden_rule': 1},
 'tidy':    {'files_out': 7, 'arithmetic': 0, 'dates': 0, 'exact_edit': 0, 'messy_input': 1, 'many_files': 1, 'hidden_rule': 1},
 'website': {'files_out': 2, 'arithmetic': 0, 'dates': 0, 'exact_edit': 0, 'messy_input': 0, 'many_files': 1, 'hidden_rule': 0},
 'dedupe':  {'files_out': 1, 'arithmetic': 0, 'dates': 0, 'exact_edit': 1, 'messy_input': 1, 'many_files': 0, 'hidden_rule': 1},
 'dates':   {'files_out': 1, 'arithmetic': 0, 'dates': 1, 'exact_edit': 0, 'messy_input': 1, 'many_files': 0, 'hidden_rule': 1},
 'minutes': {'files_out': 1, 'arithmetic': 0, 'dates': 1, 'exact_edit': 1, 'messy_input': 0, 'many_files': 0, 'hidden_rule': 1},
 'budget':  {'files_out': 1, 'arithmetic': 1, 'dates': 1, 'exact_edit': 0, 'messy_input': 0, 'many_files': 1, 'hidden_rule': 1},
 'phone':   {'files_out': 4, 'arithmetic': 0, 'dates': 0, 'exact_edit': 1, 'messy_input': 1, 'many_files': 1, 'hidden_rule': 1},
 'report':  {'files_out': 0, 'arithmetic': 0, 'dates': 0, 'exact_edit': 0, 'messy_input': 1, 'many_files': 0, 'hidden_rule': 1},
}
runs = [r for r in rows if r['job'] in NEW and r['model'] in MODELS and 'tools' in r]
def behaviour(r):
    t = r['tools']
    writes = [i for i, x in enumerate(t) if x.startswith('✓ writeFile') or (x.startswith('✓ runBash') and any(k in x for k in ['mv ', 'mkdir', '>', 'sed', 'cp ']))]
    last_write = writes[-1] if writes else -1
    checked_after = any(x.startswith('✓ readFile') or x.startswith('✓ runBash') or x.startswith('✓ listDir') for x in t[last_write+1:]) if last_write >= 0 else False
    fails = sum(1 for x in t if x.startswith('✗') and 'waits until' not in x)
    used_script = any(x.startswith('✓ runBash') and any(k in x for k in ['node ', 'python'] ) for x in t)
    return {'steps': len(t), 'tool_failures': fails, 'writes': len(writes), 'checked_after_last_write': checked_after, 'ran_a_script': used_script}
print(f'{len(runs)} runs')
by = collections.defaultdict(list)
for r in runs: by[(r['model'].split('/')[1], r['job'])].append(r['pass'])
print('\nPass rate by job:')
for job in NEW:
    print(f"  {job:8}", '  '.join(f"{m.split('/')[1][:14]} {sum(by[(m.split('/')[1], job)])}/{len(by[(m.split('/')[1], job)])}" for m in MODELS))
for m in MODELS:
    mr = [r for r in runs if r['model'] == m]
    print(f"{m}: {sum(r['pass'] for r in mr)}/{len(mr)}  cost ${sum(r['cost'] for r in mr):.3f}  avg {sum(r['seconds'] for r in mr)/max(1,len(mr)):.0f}s")
def rate(group):
    return f"{sum(not r['pass'] for r in group)}/{len(group)} failed" if group else 'none'
print('\nJob features (failure rate with / without):')
for tag in TAGS['letter']:
    if tag == 'files_out': continue
    w = [r for r in runs if TAGS[r['job']][tag]]; wo = [r for r in runs if not TAGS[r['job']][tag]]
    print(f"  {tag:14} with: {rate(w):14} without: {rate(wo)}")
one = [r for r in runs if TAGS[r['job']]['files_out'] <= 1]; several = [r for r in runs if TAGS[r['job']]['files_out'] > 1]
print(f"  {'one file':14} {rate(one):14} several files: {rate(several)}")
print('\nBehaviour in the run (failure rate with / without):')
for key in ['checked_after_last_write', 'ran_a_script']:
    w = [r for r in runs if behaviour(r)[key]]; wo = [r for r in runs if not behaviour(r)[key]]
    print(f"  {key:26} yes: {rate(w):14} no: {rate(wo)}")
w = [r for r in runs if behaviour(r)['tool_failures'] > 0]; wo = [r for r in runs if behaviour(r)['tool_failures'] == 0]
print(f"  {'a tool failed':26} yes: {rate(w):14} no: {rate(wo)}")
print('\nFailures:')
for r in runs:
    if not r['pass']:
        b = behaviour(r)
        print(f"  {r['model'].split('/')[1][:14]} {r['job']}#{r['rep']} steps={b['steps']} fails={b['tool_failures']} checked={b['checked_after_last_write']} | {' ; '.join(r['tools'])[:230]}\n     said: {r['text'][:200]!r}")
