import re
main = open('Main.dc.html').read()
head = main[:main.index('<div style="width: 1440px;')]
sidebar = main[main.index('  <aside'):main.index('</aside>')+len('</aside>')]
header = main[main.index('    <header'):main.index('</header>')+len('</header>')]

ACTIVE = 'padding: 8px 10px; border-radius: 8px; background: #E4EFE8; color: #2C4A38; font-size: 13px; font-weight: 600;'
PLAIN  = 'padding: 7px 10px; border-radius: 8px; color: #3B3A32; font-size: 13px; font-weight: 500;'

def shell(active_label, body, search='Search students, teachers, classes, pages…'):
    sb = sidebar.replace(ACTIVE, PLAIN, 1)
    pat = re.compile(r'(<div style="display: flex; align-items: center; gap: 10px; )' + re.escape(PLAIN) + r'("><svg(?:(?!<span>).)*?</svg><span>' + re.escape(active_label) + r'</span>)', re.S)
    sb, n = pat.subn(r'\1' + ACTIVE + r'\2', sb, count=1)
    assert n == 1, active_label
    hd = header.replace('Search students, teachers, classes, pages…', search)
    return (head + '<div style="width: 1440px; height: 900px; display: flex; background: #F3F3EE; color: #26251F; overflow: hidden;">\n\n'
            + sb + '\n\n  <div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">\n' + hd + '\n' + body + '\n  </div>\n</div>\n</x-dc>\n</body>\n</html>\n')

ICON_SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C9B90" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'
PLUS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
DL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'

def pagehead(crumb, title, sub, actions=''):
    return f'''      <div style="display: flex; align-items: flex-end; justify-content: space-between;">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="font-size: 12.5px; color: #75746B; font-weight: 500;">{crumb}</div>
          <h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">{title}</h1>
          <div style="font-size: 12.5px; color: #75746B;">{sub}</div>
        </div>
        <div style="display: flex; gap: 8px;">{actions}</div>
      </div>'''

def btn(label, kind='ghost', icon=''):
    if kind == 'primary':
        return f'<div style="display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 10px; background: #26251F; color: #FFFFFF; font-size: 12.5px; font-weight: 600;">{icon}{label}</div>'
    return f'<div style="display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 10px; border: 1px solid #DBDAD0; background: #FFFFFF; font-size: 12.5px; font-weight: 600;">{icon}{label}</div>'

def select(label, value, w=''):
    return f'<div style="display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 1px solid #DBDAD0; border-radius: 10px; background: #FFFFFF; font-size: 12.5px; font-weight: 600; {w}"><span style="color: #75746B; font-weight: 500;">{label}</span>{value}{CHEV}</div>'

def searchbox(ph, w='320px'):
    return f'<div style="display: flex; align-items: center; gap: 8px; height: 36px; width: {w}; padding: 0 12px; border: 1px solid #DBDAD0; border-radius: 10px; background: #FFFFFF; color: #75746B; font-size: 12.5px;">{ICON_SEARCH}<span>{ph}</span></div>'

def pill(text, tone):
    t = {'green': ('#E4EFE8', '#2C4A38'), 'gold': ('#F5EBD8', '#8A670E'), 'red': ('#F6E4E2', '#B5372A'), 'muted': ('#F5F5F0', '#75746B'), 'ink': ('#26251F', '#FFFFFF'),
         'hblue': ('#E7EDF6', '#3B6FB5'), 'hred': ('#F6E4E4', '#C24444'), 'hgreen': ('#E4EFE8', '#3E8E5A'), 'hyellow': ('#F5EBD8', '#A87E12')}[tone]
    return f'<span style="display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; background: {t[0]}; color: {t[1]};">{text}</span>'

def card(inner, extra=''):
    return f'<section style="background: #FFFFFF; border: 1px solid #E9E8E0; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; {extra}">{inner}</section>'

def thead(cols, tpl):
    cells = ''.join(f'<div style="{("text-align: right;" if c.startswith(">") else "")}">{c.lstrip(">")}</div>' for c in cols)
    return f'<div style="display: grid; grid-template-columns: {tpl}; gap: 12px; padding: 8px 18px; font-size: 10.5px; color: #9C9B90; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; background: #FAFAF7; border-bottom: 1px solid #E9E8E0;">{cells}</div>'

def trow(cells, tpl, last=False, bg=''):
    inner = ''.join(f'<div{" style=\"text-align: right;\"" if c.startswith(">") else ""}>{c.lstrip(">")}</div>' for c in cells)
    return f'<div style="display: grid; grid-template-columns: {tpl}; gap: 12px; padding: 10px 18px; font-size: 12.5px; align-items: center; {"" if last else "border-bottom: 1px solid #F5F5F0;"} {bg}">{inner}</div>'

MAIN = lambda inner: f'    <main style="flex: 1; overflow: hidden; padding: 24px 28px; display: flex; flex-direction: column; gap: 18px;">\n{inner}\n    </main>'

# ---------------- STUDENTS ----------------
tpl = '70px minmax(0, 1.6fr) 120px 110px 130px 130px 100px'
rows = [
 ('1','Aarav Srivastava','RKA/2019/0412','Class 10-A','Computer Apps','98391 12xxx','Active','hblue'),
 ('2','Ananya Singh','RKA/2018/0287','Class 10-A','Sanskrit','94150 88xxx','Active','hred'),
 ('3','Aditya Pandey','RKA/2020/0563','Class 10-A','Computer Apps','70073 45xxx','Active','hgreen'),
 ('4','Bhavya Mishra','RKA/2019/0430','Class 10-A','Sanskrit','98079 30xxx','Active','hyellow'),
 ('5','Devansh Yadav','RKA/2021/0701','Class 10-A','Computer Apps','99358 21xxx','Active','hblue'),
 ('6','Ishita Gupta','RKA/2019/0418','Class 10-A','Sanskrit','63935 66xxx','Active','hgreen'),
 ('7','Kavya Rai','RKA/2018/0301','Class 10-A','Computer Apps','79858 09xxx','Active','hred'),
 ('8','Manas Tiwari','RKA/2019/0455','Class 10-A','Sanskrit','94520 77xxx','Active','hyellow'),
 ('9','Nitya Verma','RKA/2022/0812','Class 10-A','Computer Apps','88406 12xxx','Active','hblue'),
 ('10','Pranav Chaubey','RKA/2019/0466','Class 10-A','Sanskrit','75069 43xxx','Active','hgreen'),
 ('11','Shaurya Upadhyay','RKA/2020/0590','Class 10-A','Sanskrit','98380 57xxx','Withdrawn','hyellow'),
]
house = {'hblue':'Blue','hred':'Red','hgreen':'Green','hyellow':'Yellow'}
trs = ''
for i,(r,n,a,c,o,p,s,h) in enumerate(rows):
    name = f'<div style="display: flex; align-items: center; gap: 10px;"><span style="width: 28px; height: 28px; border-radius: 50%; background: #F5F5F0; color: #3B3A32; font-size: 10.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;">{"".join(w[0] for w in n.split()[:2])}</span><span style="display: flex; flex-direction: column;"><span style="font-weight: 600;">{n}</span><span style="font-size: 11px; color: #75746B;">{house[h]} house</span></span></div>'
    trs += trow([r, name, f'<span style="color: #3B3A32;">{a}</span>', c, o, f'<span style="color: #3B3A32;">{p}</span>', pill(s, 'green' if s=='Active' else 'muted')], tpl, last=(i==len(rows)-1), bg=('opacity: 0.6;' if s=='Withdrawn' else ''))
students_body = MAIN(pagehead('People', 'Students', 'Roster from SMS · read-only here, edited at the front desk', btn('Export CSV', icon=DL) + btn('Roll assign', icon='') + btn('Add student', 'primary', PLUS)) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">
        {searchbox('Search by name, roll number, or admission no…', '360px')}
        {select('Class', 'Class 10-A')}
        {select('Section', 'All')}
        {select('Status', 'Active')}
        <div style="flex: 1;"></div>
        <div style="display: flex; gap: 6px;">{pill('712 total', 'muted')}{pill('683 active', 'green')}{pill('29 withdrawn', 'muted')}</div>
      </div>
      {card(f'''
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid #E9E8E0;">
          <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; font-weight: 700;">Class 10-A</div><div style="font-size: 12px; color: #75746B;">42 students · class teacher Priya Tiwari · sorted by roll</div></div>
          <div style="display: flex; gap: 6px;">{pill('Blue 11', 'hblue')}{pill('Red 10', 'hred')}{pill('Green 11', 'hgreen')}{pill('Yellow 10', 'hyellow')}</div>
        </div>
        {thead(['Roll', 'Name', 'Admission no.', 'Class', 'Optional', 'Parent phone', 'Status'], tpl)}
        {trs}
        <div style="margin-top: auto; display: flex; align-items: center; justify-content: space-between; padding: 10px 18px; border-top: 1px solid #E9E8E0; font-size: 12px; color: #75746B;">
          <span>Showing 1–11 of 42</span>
          <div style="display: flex; gap: 4px;"><span style="padding: 4px 10px; border-radius: 7px; border: 1px solid #DBDAD0; color: #9C9B90;">Prev</span><span style="padding: 4px 10px; border-radius: 7px; background: #26251F; color: #FFFFFF; font-weight: 600;">1</span><span style="padding: 4px 10px; border-radius: 7px; border: 1px solid #DBDAD0;">2</span><span style="padding: 4px 10px; border-radius: 7px; border: 1px solid #DBDAD0;">3</span><span style="padding: 4px 10px; border-radius: 7px; border: 1px solid #DBDAD0;">4</span><span style="padding: 4px 10px; border-radius: 7px; border: 1px solid #DBDAD0;">Next</span></div>
        </div>''', 'flex: 1; min-height: 0;')}''')
open('Students.dc.html','w').write(shell('Students', students_body))

# ---------------- STUDENT PROFILE ----------------
def stat(label, value, sub, color='#26251F'):
    return f'<div style="background: #FFFFFF; border: 1px solid #E9E8E0; border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px;"><div style="font-size: 12px; color: #75746B; font-weight: 500;">{label}</div><div style="font-size: 26px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: {color};">{value}</div><div style="font-size: 11.5px; color: #75746B;">{sub}</div></div>'
def bar(label, pct, val, color='#3E8E5A'):
    return f'<div style="display: grid; grid-template-columns: 120px minmax(0, 1fr) 44px; gap: 10px; align-items: center; font-size: 12.5px;"><span>{label}</span><div style="height: 8px; background: #E9E8E0; border-radius: 99px; overflow: hidden;"><div style="width: {pct}%; height: 100%; background: {color}; border-radius: 99px;"></div></div><span style="text-align: right; color: #3B3A32; font-weight: 600;">{val}</span></div>'
spark = '<svg width="100%" height="120" viewBox="0 0 520 120" preserveAspectRatio="none"><polyline points="0,70 65,58 130,66 195,40 260,48 325,30 390,36 455,22 520,28" fill="none" stroke="#3E8E5A" stroke-width="2.5" stroke-linejoin="round"/><polyline points="0,82 65,80 130,78 195,74 260,72 325,70 390,68 455,66 520,64" fill="none" stroke="#DBDAD0" stroke-width="2" stroke-dasharray="4 4"/></svg>'
ttpl = 'minmax(0, 1.5fr) 110px 90px 70px 70px 90px'
tests_rows = ''.join(trow(c, ttpl, last=(i==4)) for i,c in enumerate([
  ['<span style="font-weight: 600;">Half-yearly · Mathematics</span>', '12 Sep 2026', 'Exam', '80', '<span style="font-weight: 600;">71</span>', pill('Above class avg', 'green')],
  ['<span style="font-weight: 600;">Half-yearly · English</span>', '10 Sep 2026', 'Exam', '80', '<span style="font-weight: 600;">64</span>', pill('On avg', 'muted')],
  ['<span style="font-weight: 600;">MT · Science (Aug)</span>', '28 Aug 2026', 'Monthly', '30', '<span style="font-weight: 600;">26</span>', pill('Above class avg', 'green')],
  ['<span style="font-weight: 600;">MT · Social Science (Aug)</span>', '27 Aug 2026', 'Monthly', '30', '<span style="color: #B5372A; font-weight: 600;">Absent</span>', pill('Absent', 'red')],
  ['<span style="font-weight: 600;">Unit Test 2 · Hindi</span>', '19 Aug 2026', 'Scheduled', '25', '<span style="font-weight: 600;">18</span>', pill('Below class avg', 'gold')],
]))
profile_body = MAIN(f'''
      <div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #75746B;"><span>People</span><span>/</span><span>Students</span><span>/</span><span>Class 10-A</span><span>/</span><span style="color: #26251F; font-weight: 600;">Aarav Srivastava</span></div>
      <div style="background: #FFFFFF; border: 1px solid #E9E8E0; border-radius: 14px; padding: 18px 20px; display: flex; align-items: center; gap: 18px;">
        <div style="width: 64px; height: 64px; border-radius: 16px; background: #E7EDF6; color: #3B6FB5; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center;">AS</div>
        <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
          <div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">Aarav Srivastava</span>{pill('Active', 'green')}{pill('Blue house', 'hblue')}</div>
          <div style="display: flex; gap: 18px; font-size: 12.5px; color: #3B3A32;"><span><span style="color: #75746B;">Class</span> 10-A · Roll 1</span><span><span style="color: #75746B;">Admission</span> RKA/2019/0412</span><span><span style="color: #75746B;">Father</span> Rakesh Srivastava · 98391 12xxx</span><span><span style="color: #75746B;">Optional</span> Computer Applications</span></div>
        </div>
        <div style="display: flex; gap: 8px;">{btn('Open in SMS')}{btn('Report card', 'primary')}</div>
      </div>
      <div style="display: flex; gap: 2px; border-bottom: 1px solid #E9E8E0;">
        <div style="padding: 8px 14px; font-size: 13px; font-weight: 700; border-bottom: 2px solid #26251F;">Overview</div>
        <div style="padding: 8px 14px; font-size: 13px; font-weight: 500; color: #75746B;">Profile</div>
        <div style="padding: 8px 14px; font-size: 13px; font-weight: 500; color: #75746B;">Attendance</div>
        <div style="padding: 8px 14px; font-size: 13px; font-weight: 500; color: #75746B;">All tests</div>
        <div style="padding: 8px 14px; font-size: 13px; font-weight: 500; color: #75746B;">By subject</div>
        <div style="padding: 8px 14px; font-size: 13px; font-weight: 500; color: #75746B;">History</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">
        {stat('Overall average', '78.4%', 'Across 14 tests this session')}
        {stat('Tests appeared', '13', 'of 14 · 1 absent')}
        {stat('Attendance', '94.1%', '112 of 119 school days', '#3E8E5A')}
        {stat('Absences this month', '2', 'No 3-day streak', '#26251F')}
      </div>
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 16px;">
        <div style="display: flex; flex-direction: column; gap: 16px; min-height: 0;">
          {card(f'<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid #E9E8E0;"><div style="font-size: 13.5px; font-weight: 700;">Score trend across tests</div><div style="font-size: 12px; color: #75746B;">Solid: student · dashed: class average</div></div><div style="padding: 14px 18px 8px;">{spark}</div>')}
          {card(f'<div style="padding: 12px 18px; border-bottom: 1px solid #E9E8E0; font-size: 13.5px; font-weight: 700;">Recent tests</div>{thead(["Test", "Date", "Kind", "Max", "Score", "vs class"], ttpl)}{tests_rows}', 'flex: 1; min-height: 0;')}
        </div>
        {card(f'''<div style="padding: 12px 18px; border-bottom: 1px solid #E9E8E0; font-size: 13.5px; font-weight: 700;">Subject-wise average</div>
          <div style="padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;">
            {bar('Mathematics', 89, '89%')}{bar('Science', 84, '84%')}{bar('Computer Apps', 82, '82%')}{bar('English', 76, '76%')}{bar('Social Science', 74, '74%')}{bar('Hindi', 66, '66%', '#A87E12')}
          </div>
          <div style="margin-top: auto; padding: 12px 18px; border-top: 1px solid #E9E8E0; display: flex; flex-direction: column; gap: 6px;">
            <div style="font-size: 11px; font-weight: 600; color: #9C9B90; letter-spacing: 0.08em; text-transform: uppercase;">Teacher remarks</div>
            <div style="font-size: 12.5px; color: #3B3A32; line-height: 1.5;">"Strong in problem-solving; needs to write full steps in Hindi answers." <span style="color: #75746B;">· Meera Kumari, 3 Sep</span></div>
          </div>''')}
      </div>''')
open('StudentProfile.dc.html','w').write(shell('Students', profile_body))

# ---------------- ATTENDANCE ----------------
days = list(range(1,15))
def att_row(cls, teacher, vals, pct, marked=True, last=False):
    cells = ''
    for v in vals:
        if v is None: cells += '<div style="height: 26px; border-radius: 5px; background: #F5F5F0;"></div>'
        elif v == 'H': cells += '<div style="height: 26px; border-radius: 5px; background: #FFFFFF; border: 1px dashed #DBDAD0;"></div>'
        else:
            col, fg = ('#3E8E5A','#FFFFFF') if v>=94 else (('#8DBF9F','#1E3A2A') if v>=90 else (('#D7B85A','#3B2E08') if v>=85 else ('#C9756A','#FFFFFF')))
            cells += f'<div style="height: 26px; border-radius: 5px; background: {col}; color: {fg}; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center;">{v}</div>'
    right = f'<div style="text-align: right; font-weight: 700;">{pct}</div>' if marked else f'<div style="display: flex; flex-direction: column; align-items: flex-end;"><span style="font-weight: 700;">{pct}</span><span style="font-size: 10.5px; color: #8A670E; font-weight: 600;">Today not marked</span></div>'
    return f'<div style="display: grid; grid-template-columns: 150px repeat(14, minmax(0, 1fr)) 110px; gap: 4px; align-items: center; padding: 4px 18px; {"" if last else "border-bottom: 1px solid #F5F5F0;"}"><div style="display: flex; flex-direction: column;"><span style="font-size: 12.5px; font-weight: 600;">{cls}</span><span style="font-size: 10.5px; color: #75746B;">{teacher}</span></div>{cells}{right}</div>'
import random
random.seed(4)
def series(base, today_missing=False):
    out=[]
    for d in days:
        if d in (6,13): out.append('H')
        elif d==14 and today_missing: out.append(None)
        else: out.append(max(78, min(99, base + random.randint(-4,4))))
    return out
att_rows = ''
data = [('Nursery','Sunita Devi',96,'96.1%'),('LKG','Poonam Rai',95,'95.0%'),('UKG','Rekha Singh',94,'94.2%'),('Class 1','Anju Mishra',93,'92.8%'),('Class 2','S. Kumari',93,'93.1%'),('Class 3','Neha Pandey',95,'94.6%'),('Class 4','R. Yadav',91,'91.4%'),('Class 5','Meera Kumari',92,'92.0%'),('Class 6-A','Kamal Nath',90,'90.3%'),('Class 7-A','Ritu Singh',87,'87.2%'),('Class 8-A','Anil Verma',91,'91.2%',True),('Class 9-B','D. Yadav',83,'83.4%'),('Class 10-A','Priya Tiwari',88,'88.0%'),('Class 12 Sci','S. K. Pandey',94,'93.9%')]
for i,row in enumerate(data):
    miss = len(row)>4
    att_rows += att_row(row[0], row[1], series(row[2], miss), row[3], marked=not miss, last=(i==len(data)-1))
dayhead = ''.join(f'<div style="text-align: center; {"color: #26251F; font-weight: 700;" if d==14 else ""}">{d}</div>' for d in days)
attendance_body = MAIN(pagehead('People', 'Attendance', 'Present % of marked students · unmarked classes never show 0%', btn('Export month', icon=DL) + btn('Absentee streaks', 'primary')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">
        {select('Month', 'September 2026')}
        {select('Classes', 'All · Main')}
        <div style="display: flex; background: #F5F5F0; border: 1px solid #E9E8E0; border-radius: 9px; padding: 3px; gap: 2px;"><div style="padding: 5px 12px; font-size: 12px; font-weight: 600; background: #FFFFFF; border-radius: 7px; box-shadow: 0 1px 3px rgba(38,37,31,0.08);">Heatmap</div><div style="padding: 5px 12px; font-size: 12px; font-weight: 500; color: #75746B;">Analytics</div><div style="padding: 5px 12px; font-size: 12px; font-weight: 500; color: #75746B;">Per student</div></div>
        <div style="flex: 1;"></div>
        <div style="display: flex; gap: 14px; font-size: 11.5px; color: #75746B; align-items: center;">
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #3E8E5A; display: inline-block;"></span>≥ 94</span>
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #8DBF9F; display: inline-block;"></span>90–93</span>
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #D7B85A; display: inline-block;"></span>85–89</span>
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #C9756A; display: inline-block;"></span>&lt; 85</span>
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; border: 1px dashed #DBDAD0; display: inline-block;"></span>Holiday</span>
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #F5F5F0; display: inline-block;"></span>Not marked</span>
        </div>
      </div>
      {card(f'''
        <div style="display: grid; grid-template-columns: 150px repeat(14, minmax(0, 1fr)) 110px; gap: 4px; padding: 10px 18px 6px; font-size: 10.5px; color: #9C9B90; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #E9E8E0; background: #FAFAF7;"><div>Class</div>{dayhead}<div style="text-align: right;">Month to date</div></div>
        {att_rows}
        <div style="margin-top: auto; padding: 10px 18px; border-top: 1px solid #E9E8E0; font-size: 12px; color: #75746B; display: flex; justify-content: space-between;"><span>Showing 14 of 34 classes · scroll for more</span><span>Today: 665 present of 690 marked · Class 8-A (22 students) not yet marked</span></div>''', 'flex: 1; min-height: 0;')}''')
open('Attendance.dc.html','w').write(shell('Attendance', attendance_body))

# ---------------- TIMETABLE ----------------
def tcell(subj, teacher, color='#E4EFE8', fg='#2C4A38', sel=False):
    border = 'border: 2px solid #26251F;' if sel else 'border: 1px solid transparent;'
    return f'<div style="height: 52px; border-radius: 8px; background: {color}; color: {fg}; padding: 6px 8px; display: flex; flex-direction: column; justify-content: center; gap: 1px; {border}"><span style="font-size: 12px; font-weight: 700;">{subj}</span><span style="font-size: 10.5px; opacity: 0.85;">{teacher}</span></div>'
def tempty(): return '<div style="height: 52px; border-radius: 8px; border: 1px dashed #DBDAD0; color: #9C9B90; font-size: 11px; display: flex; align-items: center; justify-content: center;">Click to assign</div>'
tt_rows = [
 ('Class 9-A', [tcell('Maths','S. K. Pandey'), tcell('English','Ritu Singh'), tcell('Science','N. Rai'), tcell('Hindi','K. N. Mishra'), tcell('SSt','Priya Tiwari'), tcell('Sanskrit','K. N. Mishra'), tcell('Comp','R. Gupta'), tcell('PE','D. Yadav','#F5F5F0','#3B3A32')]),
 ('Class 9-B', [tcell('English','Ritu Singh'), tcell('Maths','S. K. Pandey'), tcell('Hindi','Meera Kumari'), tcell('Science','N. Rai'), tcell('SSt','Priya Tiwari'), tempty(), tcell('Sanskrit','K. N. Mishra'), tcell('Art','S. Das','#F5F5F0','#3B3A32')]),
 ('Class 10-A', [tcell('Science','A. Verma'), tcell('SSt','Priya Tiwari'), tcell('Maths','S. K. Pandey', sel=True), tcell('English','Ritu Singh'), tcell('Hindi','Meera Kumari'), tcell('Comp','R. Gupta'), tcell('Science','A. Verma'), tcell('Library','—','#F5F5F0','#3B3A32')]),
 ('Class 10-B', [tcell('Hindi','Meera Kumari'), tcell('Science','N. Rai'), tcell('English','Ritu Singh'), tcell('Maths','S. K. Pandey'), tempty(), tcell('SSt','Priya Tiwari'), tcell('Comp','R. Gupta'), tcell('PE','D. Yadav','#F5F5F0','#3B3A32')]),
 ('Class 11 Sci', [tcell('Physics','A. Verma'), tcell('Chem','N. Rai'), tcell('Bio','S. Das'), tcell('English','Ritu Singh'), tcell('Physics','A. Verma'), tcell('Bio','S. Das'), tcell('Chem','N. Rai'), tempty()]),
 ('Class 11 Com', [tcell('Accounts','Priya Tiwari'), tcell('Business','Priya Tiwari'), tcell('Eco','Kamal Nath'), tcell('English','Ritu Singh'), tcell('Maths','?','#F6E4E2','#B5372A'), tcell('Accounts','Priya Tiwari'), tempty(), tempty()]),
]
grid = ''
for i,(cls,cells) in enumerate(tt_rows):
    grid += f'<div style="display: grid; grid-template-columns: 110px repeat(8, minmax(0, 1fr)); gap: 6px; align-items: center; padding: 5px 18px; {"" if i==len(tt_rows)-1 else "border-bottom: 1px solid #F5F5F0;"}"><div style="font-size: 12.5px; font-weight: 600;">{cls}</div>{"".join(cells)}</div>'
phead = ''.join(f'<div style="text-align: center; display: flex; flex-direction: column; gap: 1px;"><span>P{p}</span><span style="font-weight: 400; letter-spacing: 0; text-transform: none; color: #9C9B90;">{t}</span></div>' for p,t in zip(range(1,9), ['8:00','8:45','9:30','10:15','11:15','12:00','12:45','13:30']))
timetable_body = MAIN(pagehead('Schedule', 'Timetable', 'Monday · Main · 34 classes, 48 teachers · click a cell to assign or edit', btn('Copy Monday to…') + btn('Print class-wise') + btn('Period times')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="display: flex; background: #F5F5F0; border: 1px solid #E9E8E0; border-radius: 9px; padding: 3px; gap: 2px;"><div style="padding: 5px 12px; font-size: 12px; font-weight: 600; background: #FFFFFF; border-radius: 7px; box-shadow: 0 1px 3px rgba(38,37,31,0.08);">By day</div><div style="padding: 5px 12px; font-size: 12px; font-weight: 500; color: #75746B;">By teacher</div><div style="padding: 5px 12px; font-size: 12px; font-weight: 500; color: #75746B;">By class</div></div>
        <div style="display: flex; gap: 4px;">{"".join(f'<div style="padding: 7px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; {"background: #26251F; color: #FFFFFF;" if d=="Mon" else "border: 1px solid #DBDAD0; background: #FFFFFF;"}">{d}</div>' for d in ["Mon","Tue","Wed","Thu","Fri","Sat"])}</div>
        {select('Classes', 'Secondary (9–12)')}
        <div style="flex: 1;"></div>
        <div style="display: flex; gap: 6px;">{pill('5 unassigned slots', 'gold')}{pill('1 subject without teacher', 'red')}</div>
      </div>
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px;">
        {card(f'<div style="display: grid; grid-template-columns: 110px repeat(8, minmax(0, 1fr)); gap: 6px; padding: 10px 18px; font-size: 10.5px; color: #9C9B90; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #E9E8E0; background: #FAFAF7;"><div>Class</div>{phead}</div>{grid}')}
        {card(f'''<div style="padding: 14px 18px; border-bottom: 1px solid #E9E8E0; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 13.5px; font-weight: 700;">Edit period</div><div style="font-size: 12px; color: #75746B;">Class 10-A · Monday · P3 (9:30)</div></div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">
            <div style="display: flex; flex-direction: column; gap: 5px;"><span style="font-size: 11px; color: #75746B; font-weight: 500;">Subject</span>{select('', 'Mathematics', 'width: 100%;')}</div>
            <div style="display: flex; flex-direction: column; gap: 5px;"><span style="font-size: 11px; color: #75746B; font-weight: 500;">Teacher</span>{select('', 'S. K. Pandey', 'width: 100%;')}<span style="font-size: 11.5px; color: #3E8E5A; font-weight: 600;">Free this period · teaches 10-A Maths</span></div>
            <div style="display: flex; flex-direction: column; gap: 5px;"><span style="font-size: 11px; color: #75746B; font-weight: 500;">Also apply to</span><div style="display: flex; gap: 6px; flex-wrap: wrap;">{pill('Tue', 'muted')}{pill('Wed', 'ink')}{pill('Thu', 'muted')}{pill('Fri', 'ink')}{pill('Sat', 'muted')}</div></div>
            <div style="border-top: 1px solid #E9E8E0; padding-top: 12px; display: flex; flex-direction: column; gap: 6px;"><span style="font-size: 11px; font-weight: 600; color: #9C9B90; letter-spacing: 0.08em; text-transform: uppercase;">Clashes</span><div style="font-size: 12.5px; color: #2C4A38; display: flex; align-items: center; gap: 6px;"><span style="width: 7px; height: 7px; border-radius: 50%; background: #3E8E5A;"></span>None. Teacher and room are free.</div></div>
          </div>
          <div style="margin-top: auto; padding: 12px 18px; border-top: 1px solid #E9E8E0; display: flex; gap: 8px;"><div style="flex: 1; text-align: center; padding: 9px 0; border-radius: 10px; background: #26251F; color: #FFFFFF; font-size: 12.5px; font-weight: 600;">Save</div>{btn('Clear slot')}</div>''')}
      </div>''')
open('Timetable.dc.html','w').write(shell('Timetable', timetable_body))

# ---------------- LESSON PLANS ----------------
weeks = ['6 Jul','13 Jul','20 Jul','27 Jul','3 Aug','10 Aug','17 Aug','24 Aug','31 Aug','7 Sep','14 Sep']
def lp_cell(kind):
    m = {'p': ('#3E8E5A','#FFFFFF','✓'), 'e': ('#8DBF9F','#1E3A2A','✓'), 'a': ('#A87E12','#FFFFFF','A'), 'x': ('#F6E4E2','#B5372A','—'), 'l': ('#E7EDF6','#3B6FB5','L'), 'h': ('#FFFFFF','#9C9B90',''), 'f': ('#F5F5F0','#9C9B90','')}[kind]
    extra = 'border: 1px dashed #DBDAD0;' if kind=='h' else ''
    return f'<div style="height: 30px; border-radius: 6px; background: {m[0]}; color: {m[1]}; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; {extra}">{m[2]}</div>'
lp = [
 ('S. K. Pandey','Maths · 9-A, 9-B, 10-A, 10-B, 11, 12','ppppppppppp'),
 ('Ritu Singh','English · 6–10','pppppepppppx'[:11]),
 ('Meera Kumari','Hindi · 3–5, 10','ppppppppppp'),
 ('Anil Verma','Science · 8-A, 10-A · Physics 11, 12','ppppplppppx'),
 ('Priya Tiwari','SSt · 9, 10 · Accounts 11, 12','pppeppppppp'),
 ('N. Rai','Science · 9, 10-B · Chem 11, 12','ppppppppxpx'),
 ('Rahul Gupta','Computer · 9, 10','pppxppppxxx'),
 ('K. N. Mishra','Sanskrit · 6–10','ppppppppppp'),
 ('Kamal Nath','Economics · 11, 12','ppppppappxx'),
 ('D. Yadav','PE · all','pppppppppxx'),
 ('S. Das','Biology · 11, 12 · Art','pppppppppep'),
]
lp_rows = ''
for i,(t,s,k) in enumerate(lp):
    cells = ''.join(lp_cell(c) for c in k)
    lp_rows += f'<div style="display: grid; grid-template-columns: 220px repeat(11, minmax(0, 1fr)) 70px; gap: 5px; align-items: center; padding: 4px 18px; {"" if i==len(lp)-1 else "border-bottom: 1px solid #F5F5F0;"}"><div style="display: flex; flex-direction: column;"><span style="font-size: 12.5px; font-weight: 600;">{t}</span><span style="font-size: 10.5px; color: #75746B;">{s}</span></div>{cells}<div style="text-align: right; font-size: 12px; font-weight: 700; color: {"#B5372A" if k.count("x")>=2 else "#26251F"};">{11-k.count("x")}/11</div></div>'
whead = ''.join(f'<div style="text-align: center; {"color: #26251F; font-weight: 700;" if w=="14 Sep" else ""}">{w}</div>' for w in weeks)
lessonplans_body = MAIN(pagehead('Teaching', 'Lesson plans', 'One plan per teacher per week · HRMS absence and leave shown so nobody is chased for a week they were out', btn('Plan fields') + btn('Send reminders', 'primary')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">
        {select('Teachers', 'All teachers')}{select('Weeks', 'Jul – Sep 2026')}{select('Subject', 'All')}
        <div style="flex: 1;"></div>
        <div style="display: flex; gap: 14px; font-size: 11.5px; color: #75746B; align-items: center;">
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #3E8E5A; display: inline-block;"></span>Planned</span>
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #8DBF9F; display: inline-block;"></span>Edited</span>
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #A87E12; display: inline-block;"></span>Admin edited</span>
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #E7EDF6; display: inline-block;"></span>On leave (HRMS)</span>
          <span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: #F6E4E2; display: inline-block;"></span>Missing</span>
        </div>
      </div>
      {card(f'''<div style="display: grid; grid-template-columns: 220px repeat(11, minmax(0, 1fr)) 70px; gap: 5px; padding: 10px 18px 6px; font-size: 10.5px; color: #9C9B90; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #E9E8E0; background: #FAFAF7;"><div>Teacher</div>{whead}<div style="text-align: right;">Done</div></div>{lp_rows}
        <div style="margin-top: auto; padding: 10px 18px; border-top: 1px solid #E9E8E0; font-size: 12px; color: #75746B; display: flex; justify-content: space-between;"><span>Showing 11 of 48 teachers</span><span>This week: 42 of 48 submitted · 6 missing · click any cell to open the plan</span></div>''', 'flex: 1; min-height: 0;')}''')
open('LessonPlans.dc.html','w').write(shell('Lesson plans', lessonplans_body))

# ---------------- TESTS ----------------
xtpl = 'minmax(0, 1.6fr) 110px 100px 50px 50px 80px 60px 60px 110px'
tests = [
 ['<span style="font-weight: 600;">Unit Test 3 · Mathematics</span>','Mathematics','18 Sep 2026','25','8','—','—','—',pill('Scheduled','muted')],
 ['<span style="font-weight: 600;">MT · Science (Sep)</span>','Science','16 Sep 2026','30','10','—','—','—',pill('Scheduled','muted')],
 ['<span style="font-weight: 600;">Unit Test 2 · English</span>','English','9 Sep 2026','25','8','41','18.2','1',pill('Marks entered','green')],
 ['<span style="font-weight: 600;">MT · Social Science (Aug)</span>','Social Science','27 Aug 2026','30','10','38','21.4','<span style="color: #B5372A; font-weight: 600;">4</span>',pill('Marks entered','green')],
 ['<span style="font-weight: 600;">MT · Science (Aug)</span>','Science','28 Aug 2026','30','10','42','22.9','0',pill('Marks entered','green')],
 ['<span style="font-weight: 600;">Unit Test 2 · Hindi</span>','Hindi','19 Aug 2026','25','8','40','16.1','2',pill('Locked','green')],
 ['<span style="font-weight: 600;">MT · Mathematics (Aug)</span>','Mathematics','25 Aug 2026','30','10','30','—','—',pill('12 pending','gold')],
 ['<span style="font-weight: 600;">Unit Test 1 · Computer Apps</span>','Computer Apps','5 Aug 2026','25','8','21','19.0','0',pill('Locked','green')],
]
trs = ''.join(trow(c, xtpl, last=(i==len(tests)-1)) for i,c in enumerate(tests))
tests_body = MAIN(pagehead('Assessment', 'Tests &amp; marks', 'Scheduled tests and the monthly-test regime · teachers enter marks in the PWA within the 10-minute window', btn('Regime settings') + btn('New test', 'primary', PLUS)) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="display: flex; background: #F5F5F0; border: 1px solid #E9E8E0; border-radius: 9px; padding: 3px; gap: 2px;"><div style="padding: 5px 12px; font-size: 12px; font-weight: 600; background: #FFFFFF; border-radius: 7px; box-shadow: 0 1px 3px rgba(38,37,31,0.08);">All tests</div><div style="padding: 5px 12px; font-size: 12px; font-weight: 500; color: #75746B;">Scheduled</div><div style="padding: 5px 12px; font-size: 12px; font-weight: 500; color: #75746B;">Monthly</div></div>
        {select('Class', 'Class 10-A')}{select('Subject', 'All')}{select('Session', '2026–27')}
        <div style="flex: 1;"></div>
        {searchbox('Search test name…', '240px')}
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">
        {stat('Tests this session', '14', 'Class 10-A · 8 monthly, 6 scheduled')}
        {stat('Class average', '71.3%', 'Across all entered tests')}
        {stat('Awaiting marks', '1', 'MT Mathematics (Aug) · 12 students', '#A87E12')}
        {stat('Absences recorded', '7', 'Across 5 tests · 4 in one SSt test', '#B5372A')}
      </div>
      {card(f'''<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid #E9E8E0;"><div style="font-size: 14px; font-weight: 700;">Tests · Class 10-A</div><div style="font-size: 12px; color: #75746B;">Newest first · click a row for marks, absentees and the score sheet</div></div>
        {thead(['Test', 'Subject', 'Date', 'Max', 'Pass', 'Appeared', 'Avg', 'Absent', 'Status'], xtpl)}{trs}''', 'flex: 1; min-height: 0;')}''')
open('Tests.dc.html','w').write(shell('Tests &amp; marks', tests_body))

# ---------------- CLASSES & SUBJECTS ----------------
def subj_row(name, teacher, kind='Scholastic', ok=True, last=False):
    tcell_ = f'<span style="color: #3B3A32;">{teacher}</span>' if ok else '<span style="color: #B5372A; font-weight: 600;">Unassigned</span>'
    return f'<div style="display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 110px 60px; gap: 12px; padding: 10px 18px; font-size: 12.5px; align-items: center; {"" if last else "border-bottom: 1px solid #F5F5F0;"}"><div style="font-weight: 600; display: flex; align-items: center; gap: 8px;"><span style="color: #9C9B90; cursor: grab;">⋮⋮</span>{name}</div><div>{tcell_}</div><div>{pill(kind, "muted" if kind=="Scholastic" else "gold")}</div><div style="text-align: right; color: #9C9B90;">···</div></div>'
subj_rows = ''.join([
 subj_row('English','Ritu Singh'), subj_row('Hindi','Meera Kumari'), subj_row('Mathematics','S. K. Pandey'),
 subj_row('Science','A. Verma · N. Rai · S. Das'), subj_row('Social Science','Priya Tiwari'),
 subj_row('Computer Applications','Rahul Gupta'), subj_row('Sanskrit','K. N. Mishra'),
 subj_row('Physical Education','D. Yadav','Co-scholastic'), subj_row('Work Education','—','Co-scholastic', ok=False, last=True)])
classes = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5','Class 6-A','Class 6-B','Class 7-A','Class 7-B','Class 8-A','Class 8-B','Class 9-A','Class 9-B','Class 10-A','Class 10-B','Class 11 Sci','Class 11 Com','Class 12 Sci','Class 12 Com','Class 12 Hum']
cls_list = ''
for c in classes:
    act = c=='Class 10-A'
    warn = c in ('Class 11 Com','Class 9-B')
    cls_list += f'<div style="display: flex; align-items: center; justify-content: space-between; padding: 5px 12px; border-radius: 8px; font-size: 12.5px; {"background: #26251F; color: #FFFFFF; font-weight: 600;" if act else "color: #3B3A32; font-weight: 500;"}"><span>{c}</span>{"<span style=\"width: 7px; height: 7px; border-radius: 50%; background: #B5372A;\"></span>" if warn else ""}</div>'
setup_body = MAIN(pagehead('Setup', 'Classes &amp; subjects', 'Which subjects each class takes and who teaches them · drives rosters, marks entry and the Teacher PWA', btn('Master subject list') + btn('Copy from Class 10-B') + btn('Save changes', 'primary')) + f'''
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr) 300px; gap: 16px;">
        {card(f'<div style="padding: 12px 14px; border-bottom: 1px solid #E9E8E0; font-size: 13px; font-weight: 700;">Classes · Main</div><div style="padding: 8px; display: flex; flex-direction: column; gap: 1px; overflow: hidden;">{cls_list}</div>')}
        {card(f'''<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid #E9E8E0;"><div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 14px; font-weight: 700;">Class 10-A · 9 subjects</div><div style="font-size: 12px; color: #75746B;">Drag to reorder · order is the report-card order</div></div>{btn('Add subject', 'ghost', PLUS)}</div>
          <div style="display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 110px 60px; gap: 12px; padding: 8px 18px; font-size: 10.5px; color: #9C9B90; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; background: #FAFAF7; border-bottom: 1px solid #E9E8E0;"><div>Subject</div><div>Teacher</div><div>Kind</div><div></div></div>
          {subj_rows}
          <div style="margin-top: auto; padding: 12px 18px; border-top: 1px solid #E9E8E0; display: flex; align-items: center; gap: 10px;">{searchbox('Type subject name to add…', '100%')}</div>''')}
        <div style="display: flex; flex-direction: column; gap: 14px;">
          {card(f'''<div style="padding: 12px 18px; border-bottom: 1px solid #E9E8E0; font-size: 13.5px; font-weight: 700;">Optional subjects</div>
            <div style="padding: 12px 18px; display: flex; flex-direction: column; gap: 10px; font-size: 12.5px;">
              <div style="display: flex; justify-content: space-between;"><span>Computer Applications</span><span style="color: #75746B;">22 students</span></div>
              <div style="display: flex; justify-content: space-between;"><span>Sanskrit</span><span style="color: #75746B;">20 students</span></div>
              <div style="font-size: 11.5px; color: #75746B; line-height: 1.45;">Rosters scope by each student's optional subject from SMS. 0 students unassigned.</div>
            </div>''')}
          {card(f'''<div style="padding: 12px 18px; border-bottom: 1px solid #E9E8E0; font-size: 13.5px; font-weight: 700;">Needs attention</div>
            <div style="padding: 12px 18px; display: flex; flex-direction: column; gap: 10px; font-size: 12.5px;">
              <div style="display: flex; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #B5372A; margin-top: 5px; flex-shrink: 0;"></span><span>Class 11 Com · Mathematics has no teacher</span></div>
              <div style="display: flex; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #B5372A; margin-top: 5px; flex-shrink: 0;"></span><span>Class 9-B · Work Education unassigned</span></div>
              <div style="display: flex; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #A87E12; margin-top: 5px; flex-shrink: 0;"></span><span>Class 10-A · Work Education unassigned (co-scholastic, class teacher may enter)</span></div>
            </div>''')}
        </div>
      </div>''')
open('ClassesSubjects.dc.html','w').write(shell('Setup', setup_body))
print('screens ok')

grip='<svg width="12" height="14" viewBox="0 0 12 14" fill="#9C9B90"><circle cx="4" cy="3" r="1.3"/><circle cx="8" cy="3" r="1.3"/><circle cx="4" cy="7" r="1.3"/><circle cx="8" cy="7" r="1.3"/><circle cx="4" cy="11" r="1.3"/><circle cx="8" cy="11" r="1.3"/></svg>'
dots='<svg width="14" height="14" viewBox="0 0 24 24" fill="#9C9B90"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>'
t=open('ClassesSubjects.dc.html').read().replace('<span style="color: #9C9B90; cursor: grab;">⋮⋮</span>', f'<span style="display: inline-flex; cursor: grab;">{grip}</span>').replace('<div style="text-align: right; color: #9C9B90;">···</div>', f'<div style="text-align: right;">{dots}</div>')
open('ClassesSubjects.dc.html','w').write(t)
chk='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
t=open('LessonPlans.dc.html').read().replace('justify-content: center; ">✓</div>', f'justify-content: center; ">{chk}</div>')
open('LessonPlans.dc.html','w').write(t)
