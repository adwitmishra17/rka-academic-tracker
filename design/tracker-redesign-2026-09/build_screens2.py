from build_screens import *

seg = lambda opts, on: '<div style="display: flex; background: #F5F5F0; border: 1px solid #E9E8E0; border-radius: 9px; padding: 3px; gap: 2px;">' + ''.join(f'<div style="padding: 5px 12px; font-size: 12px; font-weight: {"600" if o==on else "500"}; {"background: #FFFFFF; border-radius: 7px; box-shadow: 0 1px 3px rgba(38,37,31,0.08);" if o==on else "color: #75746B;"}">{o}</div>' for o in opts) + '</div>'
avatar = lambda n, bg='#F5F5F0', fg='#3B3A32', s=28: f'<span style="width: {s}px; height: {s}px; border-radius: 50%; background: {bg}; color: {fg}; font-size: {int(s*0.38)}px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;">{"".join(w[0] for w in n.replace(".","").split()[:2])}</span>'
legend = lambda items: '<div style="display: flex; gap: 14px; font-size: 11.5px; color: #75746B; align-items: center;">' + ''.join(f'<span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 11px; height: 11px; border-radius: 3px; background: {c}; display: inline-block;"></span>{l}</span>' for l,c in items) + '</div>'
cardhead = lambda t, s='', right='': f'<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid #E9E8E0;"><div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 13.5px; font-weight: 700;">{t}</div>{f"<div style=\"font-size: 12px; color: #75746B;\">{s}</div>" if s else ""}</div><div style="display: flex; gap: 6px; align-items: center;">{right}</div></div>'
field = lambda l, v, w='width: 100%;': f'<div style="display: flex; flex-direction: column; gap: 5px;"><span style="font-size: 11px; color: #75746B; font-weight: 500;">{l}</span>{select("", v, w)}</div>'
inputbox = lambda l, ph: f'<div style="display: flex; flex-direction: column; gap: 5px;"><span style="font-size: 11px; color: #75746B; font-weight: 500;">{l}</span><div style="height: 36px; padding: 0 12px; border: 1px solid #DBDAD0; border-radius: 10px; background: #FFFFFF; font-size: 12.5px; color: #75746B; display: flex; align-items: center;">{ph}</div></div>'
rowsof = lambda rows, tpl: ''.join(trow(c, tpl, last=(i==len(rows)-1)) for i,c in enumerate(rows))
footer = lambda l, r='': f'<div style="margin-top: auto; padding: 10px 18px; border-top: 1px solid #E9E8E0; font-size: 12px; color: #75746B; display: flex; justify-content: space-between;"><span>{l}</span><span>{r}</span></div>'

# ---------------- TEACHERS ----------------
tpl = 'minmax(0, 1.6fr) 150px minmax(0, 1.3fr) 90px 100px 110px'
rows = [
 ['S. K. Pandey','Mathematics','9-A, 9-B, 10-A, 10-B, 11 Sci, 12 Sci','32 / wk','98391 44xxx',pill('Active','green')],
 ['Ritu Singh','English','6-A → 10-B','30 / wk','94150 21xxx',pill('Active','green')],
 ['Priya Tiwari','SSt · Accounts','9-A, 9-B, 10-A, 10-B, 11 Com, 12 Com','30 / wk','99358 32xxx',pill('Active','green')],
 ['Meera Kumari','Hindi','3-A, 4-B, 5-A, 5-B, 10-A, 10-B','28 / wk','70073 09xxx',pill('Active','green')],
 ['N. Rai','Science · Chemistry','9-A, 9-B, 10-B, 11 Sci, 12 Sci','27 / wk','63935 80xxx',pill('Active','green')],
 ['Anil Verma','Science · Physics','8-A, 10-A, 11 Sci, 12 Sci','26 / wk','98079 66xxx',pill('Absent today','red')],
 ['K. N. Mishra','Sanskrit','6-A → 10-B','24 / wk','94520 13xxx',pill('Active','green')],
 ['D. Yadav','Physical Education','All classes','22 / wk','75069 28xxx',pill('Absent today','red')],
 ['S. Das','Biology · Art','11 Sci, 12 Sci · 6–8','20 / wk','93356 40xxx',pill('Active','green')],
 ['Rahul Gupta','Computer Applications','9-A, 9-B, 10-A, 10-B','18 / wk','79858 51xxx',pill('Absent today','red')],
]
trs = ''.join(trow([f'<div style="display: flex; align-items: center; gap: 10px;">{avatar(r[0])}<span style="display: flex; flex-direction: column;"><span style="font-weight: 600;">{r[0]}</span><span style="font-size: 11px; color: #75746B;">{r[0].lower().replace(". ","").replace(" ",".")}@rkacademyballia.in</span></span></div>', r[1], f'<span style="color: #3B3A32;">{r[2]}</span>', r[3], f'<span style="color: #3B3A32;">{r[4]}</span>', r[5]], tpl, last=(i==len(rows)-1)) for i,r in enumerate(rows))
body = MAIN(pagehead('People', 'Teachers', 'Linked to HRMS employees · subjects and classes drive the Teacher app', btn('Export CSV', icon=DL) + btn('Sync from HRMS') + btn('Add teacher', 'primary', PLUS)) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">{searchbox('Search teachers by name, email or subject…', '360px')}{select('Subject', 'All')}{select('Status', 'All')}<div style="flex: 1;"></div><div style="display: flex; gap: 6px;">{pill('48 total', 'muted')}{pill('45 active', 'green')}{pill('3 absent today', 'red')}</div></div>
      {card(cardhead('All teachers · Main', '48 · sorted by weekly periods') + thead(['Teacher', 'Subject', 'Classes', 'Load', 'Phone', 'Status'], tpl) + trs + footer('Showing 1–10 of 48', 'Click a row for profile, lesson activity and syllabus completion'), 'flex: 1; min-height: 0;')}''')
open('Teachers.dc.html','w').write(shell('Teachers', body))

# ---------------- TEACHER PROFILE ----------------
ltpl = '90px 90px minmax(0, 1fr) minmax(0, 1.6fr) 60px'
lrows = rowsof([
 ['Today','10-A','Mathematics','Quadratic equations · nature of roots','P3'],
 ['Today','9-B','Mathematics','Polynomials · remainder theorem','P2'],
 ['13 Sep','12 Sci','Mathematics','Integration by parts (contd.)','P4, P5'],
 ['13 Sep','10-A','Mathematics','Quadratic equations · factorisation','P3'],
 ['12 Sep','11 Sci','Mathematics','Sets · Venn diagrams','P5'],
 ['12 Sep','9-A','Mathematics','Polynomials · zeros','P1'],
], ltpl)
bars30 = ''.join(f'<div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 3px; height: 100%;"><div style="width: 100%; height: {h}px; background: {"#DBDAD0" if h==0 else "#3E8E5A"}; border-radius: 3px 3px 1px 1px;{" min-height: 3px;" if h==0 else ""}"></div></div>' for h in [40,44,38,0,42,46,40,0,36,44,42,0,40,46,38,0,44,42,40,0,0,42,44,40,0,46,44,38,0,42])
body = MAIN(f'''
      <div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #75746B;"><span>People</span><span>/</span><span>Teachers</span><span>/</span><span style="color: #26251F; font-weight: 600;">S. K. Pandey</span></div>
      <div style="background: #FFFFFF; border: 1px solid #E9E8E0; border-radius: 14px; padding: 18px 20px; display: flex; align-items: center; gap: 18px;">
        {avatar('S. K. Pandey', '#E7EDF6', '#3B6FB5', 64)}
        <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
          <div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">Sanjay Kumar Pandey</span>{pill('Active', 'green')}{pill('PGT Mathematics', 'muted')}</div>
          <div style="display: flex; gap: 18px; font-size: 12.5px; color: #3B3A32;"><span><span style="color: #75746B;">Classes</span> 9-A, 9-B, 10-A, 10-B, 11 Sci, 12 Sci</span><span><span style="color: #75746B;">Qualification</span> M.Sc Mathematics, B.Ed</span><span><span style="color: #75746B;">HRMS</span> EMP-0041 · joined Jul 2018</span><span><span style="color: #75746B;">Phone</span> 98391 44xxx</span></div>
        </div>
        <div style="display: flex; gap: 8px;">{btn('Open in HRMS')}{btn('Edit', 'primary')}</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">
        {stat('Lessons logged', '412', 'This session · 32 periods a week')}
        {stat('This month', '38', 'of 40 timetabled · 2 missed', '#26251F')}
        {stat('Tests conducted', '19', '6 classes · 2 awaiting marks')}
        {stat('Lesson plans', '11 / 11', 'Every week submitted', '#3E8E5A')}
      </div>
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 16px;">
        <div style="display: flex; flex-direction: column; gap: 16px; min-height: 0;">
          {card(cardhead('Lesson activity · last 30 days', 'One bar per school day · grey = no lesson logged') + f'<div style="padding: 14px 18px 10px; height: 96px; display: grid; grid-template-columns: repeat(30, minmax(0, 1fr)); gap: 3px;">{bars30}</div>')}
          {card(cardhead('Recent lessons') + thead(['Date', 'Class', 'Subject', 'Topics covered', 'Period'], ltpl) + lrows, 'flex: 1; min-height: 0;')}
        </div>
        {card(cardhead('Syllabus completion by class', 'Half-yearly portion') + '<div style="padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;">' + bar('Class 9-A', 92, '92%') + bar('Class 9-B', 88, '88%') + bar('Class 10-A', 96, '96%') + bar('Class 10-B', 90, '90%') + bar('Class 11 Sci', 71, '71%', '#A87E12') + bar('Class 12 Sci', 84, '84%') + '</div>' + f'''<div style="margin-top: auto; padding: 12px 18px; border-top: 1px solid #E9E8E0; display: flex; flex-direction: column; gap: 8px;"><div style="font-size: 11px; font-weight: 600; color: #9C9B90; letter-spacing: 0.08em; text-transform: uppercase;">Documents</div><div style="display: flex; gap: 6px; flex-wrap: wrap;">{pill('Class 10', 'green')}{pill('Class 12', 'green')}{pill('Graduation', 'green')}{pill('PG', 'green')}{pill('B.Ed', 'green')}{pill('Aadhaar', 'green')}{pill('PAN · missing', 'red')}</div></div>''')}
      </div>''')
open('TeacherProfile.dc.html','w').write(shell('Teachers', body))

# ---------------- LESSON LOG ----------------
def logrow(t, cls, subj, topic, per, when, tone='green', last=False):
    dot = {'green': '#3E8E5A', 'gold': '#A87E12', 'red': '#B5372A'}[tone]
    return f'<div style="display: grid; grid-template-columns: 200px 90px 120px minmax(0, 1fr) 60px 70px; gap: 12px; padding: 10px 18px; font-size: 12.5px; align-items: center; {"" if last else "border-bottom: 1px solid #F5F5F0;"}"><div style="display: flex; align-items: center; gap: 10px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: {dot}; flex-shrink: 0;"></span>{avatar(t)}<span style="font-weight: 600;">{t}</span></div><div>{cls}</div><div style="color: #3B3A32;">{subj}</div><div style="color: #3B3A32;">{topic}</div><div>{per}</div><div style="text-align: right; color: #75746B; font-size: 11.5px;">{when}</div></div>'
logs = ''.join([
 logrow('Ritu Singh','8-B','English','Poem: The Road Not Taken · stanza 1–2, homework set','P3','09:52'),
 logrow('S. K. Pandey','10-A','Mathematics','Quadratic equations · nature of roots','P3','09:48'),
 logrow('Meera Kumari','5-A','Hindi','Vyakaran · sangya ke bhed, activity sheet','P3','09:41'),
 logrow('Priya Tiwari','10-B','Social Science','Nationalism in India · Non-cooperation movement','P3','09:38'),
 logrow('N. Rai','9-A','Science','Atoms and molecules · mole concept (revision)','P3','09:35'),
 logrow('Meera Kumari','4-B','Hindi','Paath 7 · reading and word meanings','P2','08:55'),
 logrow('S. K. Pandey','9-B','Mathematics','Polynomials · remainder theorem','P2','08:50'),
 logrow('Rahul Gupta','9-A','Computer Apps','No lesson logged · teacher absent, arrangement by S. Das','P1','—','gold'),
 logrow('Anil Verma','8-A','Science','No lesson logged · uncovered period','P4','—','red', last=True),
])
body = MAIN(pagehead('Teaching', 'Lesson log', 'What was actually taught, period by period · entered by teachers in the PWA', btn('Jump to today') + btn('Export day', icon=DL)) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="display: flex; gap: 4px;">{"".join(f'<div style="padding: 7px 12px; border-radius: 9px; font-size: 12.5px; font-weight: 600; {"background: #26251F; color: #FFFFFF;" if d=="Mon 14" else "border: 1px solid #DBDAD0; background: #FFFFFF;"}">{d}</div>' for d in ["Thu 10","Fri 11","Sat 12","Mon 14","Tue 15"])}</div>
        {select('Teacher', 'All teachers')}{select('Class', 'All')}{seg(['By period', 'By teacher', 'By class'], 'By period')}
        <div style="flex: 1;"></div>{legend([('Logged','#3E8E5A'),('Arrangement','#A87E12'),('Missing','#B5372A')])}
      </div>
      <div style="display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 8px;">{"".join(f'<div style="background: #FFFFFF; border: 1px solid {"#A87E12" if i==3 else "#E9E8E0"}; border-radius: 10px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: baseline;"><span style="font-size: 12px; font-weight: 600;">P{i+1}{" · now" if i==3 else ""}</span><span style="font-size: 12px; color: #75746B;">{v}</span></div>' for i,v in enumerate(["46/46","46/46","39/44","12/45","—","—","—","—"]))}</div>
      {card(cardhead('Today · latest first', '143 of 359 timetabled lessons logged so far · 2 gaps flagged', btn('Expand all') + btn('Collapse all')) + f'<div style="display: grid; grid-template-columns: 200px 90px 120px minmax(0, 1fr) 60px 70px; gap: 12px; padding: 8px 18px; font-size: 10.5px; color: #9C9B90; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; background: #FAFAF7; border-bottom: 1px solid #E9E8E0;"><div>Teacher</div><div>Class</div><div>Subject</div><div>Topics covered</div><div>Period</div><div style="text-align: right;">Logged</div></div>' + logs + footer('Showing 9 of 143 lessons today', 'Click a row to edit as admin'), 'flex: 1; min-height: 0;')}''')
open('LessonLog.dc.html','w').write(shell('Lesson log', body))

# ---------------- HOMEWORK ----------------
def hwcard(cls, subj, t, title, due, attach=False):
    return f'<div style="background: #FFFFFF; border: 1px solid #E9E8E0; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;"><div style="display: flex; justify-content: space-between; align-items: center;"><span style="font-size: 12px; font-weight: 700;">{cls} · {subj}</span>{pill("Due " + due, "gold" if due=="tomorrow" else "muted")}</div><div style="font-size: 12.5px; color: #26251F; line-height: 1.45;">{title}</div><div style="display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #75746B;">{avatar(t, s=20)}{t}{"<span style=\"margin-left: auto; color: #3E8E5A; font-weight: 600;\">1 attachment</span>" if attach else ""}</div></div>'
hw = [hwcard('10-A','Mathematics','S. K. Pandey','Ex 4.2 Q1–Q8 · nature of roots','tomorrow',True), hwcard('8-B','English','Ritu Singh','Write a summary of stanzas 1–2, 120 words','tomorrow'), hwcard('5-A','Hindi','Meera Kumari','Sangya ke bhed · 10 examples each','Wed'), hwcard('10-B','Social Science','Priya Tiwari','Map work: centres of the Non-cooperation movement','Thu',True), hwcard('9-A','Science','N. Rai','Mole concept · numericals 1–6','tomorrow'), hwcard('11 Com','Economics','Kamal Nath','Law of demand · exceptions, one page','Fri'), hwcard('7-A','Sanskrit','K. N. Mishra','Shabd roop balak · write 3 times','Wed'), hwcard('12 Sci','Physics','Anil Verma','No homework set today · teacher absent','—')]
body = MAIN(pagehead('Teaching', 'Homework', 'Set by teachers in the PWA · visible to parents the same evening', btn('Jump to today') + btn('Export week', icon=DL)) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="display: flex; gap: 4px;">{"".join(f'<div style="padding: 7px 12px; border-radius: 9px; font-size: 12.5px; font-weight: 600; {"background: #26251F; color: #FFFFFF;" if d=="Mon 14" else "border: 1px solid #DBDAD0; background: #FFFFFF;"}">{d}</div>' for d in ["Thu 10","Fri 11","Sat 12","Mon 14","Tue 15"])}</div>
        {searchbox('Search subject / teacher / title…', '300px')}{select('Class', 'All')}
        <div style="flex: 1;"></div><div style="display: flex; gap: 6px;">{pill('31 set today', 'green')}{pill('9 classes with none', 'gold')}</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">{"".join(hw)}</div>
      {card(cardhead('Classes with no homework today', 'Parents see an empty day · nudge the class teacher') + '<div style="padding: 12px 18px; display: flex; gap: 6px; flex-wrap: wrap;">' + ''.join(pill(c, 'gold') for c in ['Nursery','LKG','UKG','Class 1','Class 2','Class 6-B','Class 8-A','Class 12 Sci','Class 12 Hum']) + '</div>', 'flex: 1; min-height: 0;')}''')
open('Homework.dc.html','w').write(shell('Homework', body))

# ---------------- ARRANGEMENT ----------------
def arr_row(p, time, cls, subj, cover, state, last=False):
    st = {'ok': pill('Covered', 'green'), 'open': pill('Uncovered', 'red'), 'free': pill('Free period', 'muted')}[state]
    cov = f'<div style="display: flex; align-items: center; gap: 8px;">{avatar(cover, s=24)}<span style="font-weight: 600;">{cover}</span></div>' if cover else '<span style="color: #B5372A; font-weight: 600;">Choose a teacher →</span>'
    bg = 'background: #FFFBF5;' if state=='open' else ''
    return f'<div style="display: grid; grid-template-columns: 70px 90px 110px minmax(0, 1fr) 110px; gap: 12px; padding: 10px 18px; font-size: 12.5px; align-items: center; {"" if last else "border-bottom: 1px solid #F5F5F0;"} {bg}"><div style="font-weight: 700;">P{p}</div><div style="color: #75746B;">{time}</div><div>{cls} <span style="color: #75746B;">{subj}</span></div><div>{cov}</div><div>{st}</div></div>'
arr = ''.join([arr_row(1,'8:00','12 Sci','Physics','Meera Kumari','ok'), arr_row(2,'8:45','11 Sci','Physics','Meera Kumari','ok'), arr_row(3,'9:30','—','—','','free'), arr_row(4,'10:15','8-A','Science','','open'), arr_row(5,'11:15','8-A','Science','','open'), arr_row(6,'12:00','—','—','','free'), arr_row(7,'12:45','10-A','Science','S. Das','ok'), arr_row(8,'13:30','—','—','','free', True)])
def cand(n, note, ok=True):
    return f'<div style="display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; border: 1px solid {"#DBDAD0" if ok else "#F5F5F0"}; background: #FFFFFF; {"" if ok else "opacity: 0.55;"}">{avatar(n, s=26)}<div style="display: flex; flex-direction: column; flex: 1;"><span style="font-size: 12.5px; font-weight: 600;">{n}</span><span style="font-size: 11px; color: #75746B;">{note}</span></div>{"<span style=\"font-size: 12px; font-weight: 600; color: #3E8E5A;\">Assign</span>" if ok else ""}</div>'
body = MAIN(pagehead('Teaching', 'Arrangement', 'Cover for absent teachers · absence pulled from HRMS punches at 8:10', btn('Print today\'s arrangements') + btn('Add arrangement', 'primary', PLUS)) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="display: flex; gap: 4px;">{"".join(f'<div style="padding: 7px 12px; border-radius: 9px; font-size: 12.5px; font-weight: 600; {"background: #26251F; color: #FFFFFF;" if d=="Mon 14" else "border: 1px solid #DBDAD0; background: #FFFFFF;"}">{d}</div>' for d in ["Sat 12","Mon 14","Tue 15"])}</div>
        <div style="display: flex; gap: 6px; align-items: center;"><span style="font-size: 12px; color: #75746B;">Absent today</span>{pill('Anil Verma · 2 open', 'red')}{pill('Rahul Gupta · covered', 'green')}{pill('D. Yadav · covered', 'green')}</div>
        <div style="flex: 1;"></div>{select('Reason', 'Medical leave')}
      </div>
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px;">
        {card(cardhead('Anil Verma · Monday 14 Sep', 'Science 8-A, 10-A · Physics 11, 12 · 5 timetabled periods, 3 free') + f'<div style="display: grid; grid-template-columns: 70px 90px 110px minmax(0, 1fr) 110px; gap: 12px; padding: 8px 18px; font-size: 10.5px; color: #9C9B90; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; background: #FAFAF7; border-bottom: 1px solid #E9E8E0;"><div>Period</div><div>Time</div><div>Class</div><div>Covering teacher</div><div>Status</div></div>' + arr + footer('Covering teachers see the period in their PWA immediately', 'Dashboard heatmap shows it in orange'))}
        {card(cardhead('Who can cover P4 · 8-A Science', 'Free this period, sorted by subject fit and load') + f'<div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">{cand("N. Rai", "Science · free P4 · 1 cover this week")}{cand("S. Das", "Biology · free P4 · 0 covers this week")}{cand("Meera Kumari", "Hindi · free P4 · already covering P1, P2")}{cand("K. N. Mishra", "Sanskrit · free P4")}{cand("Priya Tiwari", "Teaching 9-A P4", ok=False)}{cand("S. K. Pandey", "Teaching 12 Sci P4", ok=False)}</div>' + f'<div style="margin-top: auto; padding: 12px 14px; border-top: 1px solid #E9E8E0;">{inputbox("Note (optional)", "e.g. Medical leave, personal work…")}</div>')}
      </div>''')
open('Arrangement.dc.html','w').write(shell('Arrangement', body))

# ---------------- ABSENTEES ----------------
atpl = '50px minmax(0, 1.6fr) 60px 90px 110px minmax(0, 1fr) 100px'
ab = rowsof([
 ['1', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Rohit Kumar", "#F6E4E4", "#C24444")}<span style="font-weight: 600;">Rohit Kumar</span></div>', '17', '9-B', pill('6 days running', 'red'), 'SSt, Science, Maths', 'Today'],
 ['2', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Sneha Maurya", "#E7EDF6", "#3B6FB5")}<span style="font-weight: 600;">Sneha Maurya</span></div>', '4', '9-B', pill('4 days running', 'red'), 'SSt, Science', 'Today'],
 ['3', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Vivek Gond", "#E4EFE8", "#3E8E5A")}<span style="font-weight: 600;">Vivek Gond</span></div>', '22', '7-A', pill('3 days running', 'red'), 'English, Hindi', 'Today'],
 ['4', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Anjali Sahani", "#F5EBD8", "#A87E12")}<span style="font-weight: 600;">Anjali Sahani</span></div>', '9', '9-B', pill('3 days running', 'red'), 'Maths', 'Today'],
 ['5', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Aman Prajapati", "#E7EDF6", "#3B6FB5")}<span style="font-weight: 600;">Aman Prajapati</span></div>', '31', '6-A', pill('3 days running', 'red'), 'Science', 'Today'],
 ['6', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Khushi Yadav", "#F6E4E4", "#C24444")}<span style="font-weight: 600;">Khushi Yadav</span></div>', '12', '9-B', pill('3 days running', 'red'), 'Hindi, SSt', 'Today'],
 ['7', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Prince Verma", "#E4EFE8", "#3E8E5A")}<span style="font-weight: 600;">Prince Verma</span></div>', '28', '8-B', pill('3 days running', 'red'), 'Science, English', 'Today'],
 ['8', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Tanya Singh", "#F5EBD8", "#A87E12")}<span style="font-weight: 600;">Tanya Singh</span></div>', '7', '10-A', pill('3 days running', 'red'), 'Maths, SSt', 'Today'],
], atpl)
body = MAIN(pagehead('People', 'Absentees', 'Consecutive-absence streaks (3+ school days) and missed tests · call list for the front desk', btn('Print call list') + btn('Send SMS to parents', 'primary')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">{searchbox('Search by name or roll…', '300px')}{select('Class', 'All')}{seg(['Streaks', 'Missed tests', 'All'], 'Streaks')}<div style="flex: 1;"></div>{select('Range', 'Last 30 days')}</div>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">{stat('Consecutive flags', '11', 'Students absent 3+ days running', '#B5372A')}{stat('Unique students', '38', 'With at least one flag or missed test')}{stat('Tests affected', '14', 'Across 9 classes')}{stat('Total absences', '96', 'Student absences · last 30 days')}</div>
      {card(cardhead('Flagged students', 'Streaks first, then most tests missed · SMS goes out at 19:30 once DLT template is live') + thead(['Rank', 'Student', 'Roll', 'Class', 'Flag', 'Subjects', 'Last absent'], atpl) + ab + footer('Showing 8 of 11 streaks · 27 more with missed tests', 'Class 9-B accounts for 4 of 11 streaks'), 'flex: 1; min-height: 0;')}''')
open('Absentees.dc.html','w').write(shell('Attendance', body))

# ---------------- PERFORMANCE ----------------
def dist(label, pcts):
    cols = ['#B5372A','#D7B85A','#8DBF9F','#3E8E5A']
    segs = ''.join(f'<div style="width: {p}%; height: 100%; background: {c};"></div>' for p,c in zip(pcts, cols))
    return f'<div style="display: grid; grid-template-columns: 120px minmax(0, 1fr) 60px; gap: 10px; align-items: center; font-size: 12.5px;"><span>{label}</span><div style="height: 12px; border-radius: 99px; overflow: hidden; display: flex; background: #E9E8E0;">{segs}</div><span style="text-align: right; font-weight: 600;">{pcts[2]+pcts[3]}% ≥ 60</span></div>'
ptpl = '50px minmax(0, 1.6fr) 60px 90px 90px minmax(0, 1fr)'
prow = rowsof([
 ['1', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Ishita Gupta", "#E4EFE8", "#3E8E5A")}<span style="font-weight: 600;">Ishita Gupta</span></div>', '6', '<span style="font-weight: 700;">91.2%</span>', '<span style="color: #3E8E5A; font-weight: 600;">▲ 2.1</span>', 'Top in Maths, Science'],
 ['2', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Aarav Srivastava", "#E7EDF6", "#3B6FB5")}<span style="font-weight: 600;">Aarav Srivastava</span></div>', '1', '<span style="font-weight: 700;">78.4%</span>', '<span style="color: #3E8E5A; font-weight: 600;">▲ 4.0</span>', 'Hindi weakest at 66%'],
 ['3', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Bhavya Mishra", "#F5EBD8", "#A87E12")}<span style="font-weight: 600;">Bhavya Mishra</span></div>', '4', '<span style="font-weight: 700;">76.9%</span>', '<span style="color: #75746B;">— 0.3</span>', 'Steady across subjects'],
 ['41', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Tanya Singh", "#F5EBD8", "#A87E12")}<span style="font-weight: 600;">Tanya Singh</span></div>', '7', '<span style="font-weight: 700; color: #B5372A;">41.5%</span>', '<span style="color: #B5372A; font-weight: 600;">▼ 6.2</span>', 'Missed 4 tests · below pass in Maths, SSt'],
 ['42', f'<div style="display: flex; align-items: center; gap: 10px;">{avatar("Manas Tiwari", "#F6E4E4", "#C24444")}<span style="font-weight: 600;">Manas Tiwari</span></div>', '8', '<span style="font-weight: 700; color: #B5372A;">39.8%</span>', '<span style="color: #B5372A; font-weight: 600;">▼ 3.4</span>', 'Below pass in Science, Hindi'],
], ptpl)
body = MAIN(pagehead('Assessment', 'Performance', 'Class-level picture from every entered test · who needs attention before the half-yearly cards', btn('Export class sheet', icon=DL) + btn('Compare classes')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">{select('Class', 'Class 10-A')}{select('Subject', 'All subjects')}{select('Tests', 'This session · 14')}<div style="flex: 1;"></div>{legend([('&lt; 33','#B5372A'),('33–59','#D7B85A'),('60–79','#8DBF9F'),('≥ 80','#3E8E5A')])}</div>
      <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px;">{stat('Students', '42', 'Class 10-A')}{stat('Tests', '14', '8 monthly · 6 scheduled')}{stat('Class average', '71.3%', '▲ 1.8 vs last month', '#3E8E5A')}{stat('Top scorer', 'Ishita G.', '91.2% overall')}{stat('Need attention', '5', 'Below 45% or 3+ tests missed', '#B5372A')}</div>
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 16px;">
        {card(cardhead('Score distribution by subject', 'Share of students per band') + '<div style="padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;">' + dist('Mathematics',[5,17,40,38]) + dist('Science',[2,21,45,32]) + dist('English',[0,24,52,24]) + dist('Social Science',[7,26,43,24]) + dist('Hindi',[10,33,41,16]) + dist('Computer Apps',[0,9,41,50]) + dist('Sanskrit',[5,20,50,25]) + '</div>')}
        {card(cardhead('Students · top 3 and bottom 2', 'Overall % across entered tests · change vs previous month') + thead(['#', 'Student', 'Roll', 'Overall', 'Change', 'Note'], ptpl) + prow + footer('Full ranked list: 42 students', 'Click a student for their profile'), 'min-height: 0;')}
      </div>''')
open('Performance.dc.html','w').write(shell('Performance', body))

# ---------------- SYLLABUS ----------------
def topic(n, name, per, state, last=False):
    st = {'done': pill('Covered', 'green'), 'part': pill('In progress', 'gold'), 'todo': pill('Not started', 'muted')}[state]
    return f'<div style="display: grid; grid-template-columns: 40px minmax(0, 1fr) 90px 110px; gap: 12px; padding: 9px 18px; font-size: 12.5px; align-items: center; {"" if last else "border-bottom: 1px solid #F5F5F0;"}"><div style="color: #75746B;">{n}</div><div style="font-weight: 600;">{name}</div><div style="color: #75746B;">{per} periods</div><div>{st}</div></div>'
def termblock(title, sub, tone, rows):
    return f'<div style="display: flex; flex-direction: column;"><div style="display: flex; align-items: center; gap: 10px; padding: 10px 18px; background: #FAFAF7; border-top: 1px solid #E9E8E0; border-bottom: 1px solid #E9E8E0;"><span style="font-size: 12.5px; font-weight: 700;">{title}</span>{pill(sub, tone)}</div>{rows}</div>'
syl = termblock('Periodic 1 · Apr–May', '3 of 3 covered', 'green', topic('1','Real numbers','8','done') + topic('2','Polynomials','10','done') + topic('3','Pair of linear equations','12','done', True)) + termblock('Half-yearly · Jun–Sep', '2 of 4 covered', 'gold', topic('4','Quadratic equations','12','part') + topic('5','Arithmetic progressions','10','done') + topic('6','Triangles','14','done') + topic('7','Coordinate geometry','8','todo', True)) + termblock('Periodic 2 · Oct–Nov', 'Not started', 'muted', topic('8','Introduction to trigonometry','12','todo') + topic('9','Applications of trigonometry','6','todo', True))
body = MAIN(pagehead('Teaching', 'Syllabus', 'Chapters per class and subject, mapped to terms · completion comes from the Lesson log', btn('Upload PDF', icon=DL) + btn('Edit chapters') + btn('Add chapter', 'primary', PLUS)) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">{select('Class', 'Class 10-A')}{select('Subject', 'Mathematics')}{seg(['All', 'Periodic 1', 'Half-yearly', 'Periodic 2', 'Pre-boards'], 'All')}<div style="flex: 1;"></div>{searchbox('Search topics or chapters…', '260px')}</div>
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px;">
        {card(cardhead('Mathematics · Class 10-A', '15 chapters · 9 shown · taught by S. K. Pandey') + '<div style="overflow: hidden; display: flex; flex-direction: column;">' + syl + '</div>' + footer('6 more chapters in Pre-boards', 'Drag to reorder within a term'), 'min-height: 0;')}
        <div style="display: flex; flex-direction: column; gap: 14px;">
          {card(cardhead('Completion') + '<div style="padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;">' + bar('Periodic 1', 100, '100%') + bar('Half-yearly', 62, '62%', '#A87E12') + bar('Periodic 2', 0, '0%', '#DBDAD0') + bar('Pre-boards', 0, '0%', '#DBDAD0') + '</div><div style="padding: 0 18px 14px; font-size: 11.5px; color: #75746B; line-height: 1.45;">Half-yearly exam starts 22 Sep. Coordinate geometry has no lesson logged yet.</div>')}
          {card(cardhead('Syllabus PDF', 'Shared with teachers and parents') + '<div style="padding: 12px 18px; display: flex; flex-direction: column; gap: 10px; font-size: 12.5px;"><div style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #DBDAD0; border-radius: 10px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B5372A" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><div style="display: flex; flex-direction: column; flex: 1;"><span style="font-weight: 600;">Class 10 · Mathematics.pdf</span><span style="font-size: 11px; color: #75746B;">1.2 MB · uploaded 4 Apr by office</span></div><span style="color: #3E8E5A; font-weight: 600; font-size: 12px;">Replace</span></div><div style="font-size: 11.5px; color: #75746B;">Nursery–8 can use one class-wide PDF instead of per subject.</div></div>')}
        </div>
      </div>''')
open('Syllabus.dc.html','w').write(shell('Syllabus', body))

# ---------------- HPC CARDS ----------------
def hrow(n, cls, dom, state, last=False):
    st = {'done': pill('Complete', 'green'), 'part': pill(dom + ' of 8 domains', 'gold'), 'todo': pill('Not started', 'muted'), 'pub': pill('Published', 'ink')}[state]
    return f'<div style="display: grid; grid-template-columns: 50px minmax(0, 1.4fr) 90px repeat(8, 28px) minmax(0, 1fr) 90px; gap: 6px; padding: 8px 18px; font-size: 12.5px; align-items: center; {"" if last else "border-bottom: 1px solid #F5F5F0;"}"><div style="color: #75746B;">{n}</div><div style="font-weight: 600;">{cls}</div><div style="color: #75746B;">Roll {n}</div>' + ''.join(f'<div style="height: 22px; border-radius: 5px; background: {"#3E8E5A" if i < int(dom) else "#E9E8E0"};"></div>' for i in range(8)) + f'<div></div><div style="text-align: right;">{st}</div></div>'
hrows = ''.join([hrow('1','Aadya Singh','8','pub'), hrow('2','Arjun Yadav','8','done'), hrow('3','Diya Gupta','8','done'), hrow('4','Harsh Pandey','5','part'), hrow('5','Kabir Rai','5','part'), hrow('6','Myra Tiwari','3','part'), hrow('7','Reyansh Mishra','0','todo'), hrow('8','Saanvi Verma','0','todo', True)])
body = MAIN(pagehead('Assessment', 'HPC cards', 'Holistic Progress Card for Nursery–5 · office-driven: one template per session, entry grid here, print to SMS', btn('Template', icon='') + btn('Print class', icon='') + btn('Publish class', 'primary')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">{seg(['Setup', 'Entry', 'Cards'], 'Entry')}{select('Session', '2026–27')}{select('Term', 'Half-yearly')}{select('Class', 'Class 3-A')}<div style="flex: 1;"></div><div style="display: flex; gap: 6px;">{pill('3 of 34 complete', 'gold')}{pill('1 published', 'ink')}</div></div>
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px;">
        {card(cardhead('Class 3-A · Half-yearly', '34 students · 8 domains per card · class teacher Neha Pandey') + '<div style="display: grid; grid-template-columns: 50px minmax(0, 1.4fr) 90px repeat(8, 28px) minmax(0, 1fr) 90px; gap: 6px; padding: 8px 18px; font-size: 10.5px; color: #9C9B90; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; background: #FAFAF7; border-bottom: 1px solid #E9E8E0;"><div>#</div><div>Student</div><div>Roll</div>' + ''.join(f'<div style="text-align: center;">D{i+1}</div>' for i in range(8)) + '<div></div><div style="text-align: right;">Status</div></div>' + hrows + footer('Showing 8 of 34', 'Click a student to enter the 8 domains'), 'min-height: 0;')}
        {card(cardhead('Harsh Pandey · Domain 6', 'Physical development') + f'''<div style="padding: 12px 18px; display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; flex-direction: column; gap: 5px;"><span style="font-size: 11px; color: #75746B; font-weight: 500;">Level</span><div style="display: flex; gap: 6px;">{pill('Beginner', 'muted')}{pill('Progressing', 'ink')}{pill('Proficient', 'muted')}</div></div>
            <div style="display: flex; flex-direction: column; gap: 5px;"><span style="font-size: 11px; color: #75746B; font-weight: 500;">Things I can do now</span><div style="min-height: 72px; padding: 8px 12px; border: 1px solid #DBDAD0; border-radius: 10px; font-size: 12.5px; color: #26251F; line-height: 1.5;">Skips rope for 20 counts<br>Catches a ball with both hands<br>Balances on one foot</div></div>
            {inputbox('Remark for this domain (optional)', 'Enjoys outdoor play; tires quickly…')}
          </div><div style="margin-top: auto; padding: 12px 18px; border-top: 1px solid #E9E8E0; display: flex; gap: 8px;"><div style="flex: 1; text-align: center; padding: 9px 0; border-radius: 10px; background: #26251F; color: #FFFFFF; font-size: 12.5px; font-weight: 600;">Save · next domain</div>{btn('Discard')}</div>''')}
      </div>''')
open('HpcCards.dc.html','w').write(shell('HPC cards', body))

# ---------------- BOARD CANDIDATES ----------------
btpl = '40px minmax(0, 1.5fr) 110px 110px 140px minmax(0, 1.2fr) 100px'
brows = rowsof([
 ['1', '<span style="font-weight: 600;">Aarav Srivastava</span>', '12 Mar 2011', '2101 0447 xxxx', 'Regular', 'Eng, Hin, Mat, Sci, SSt, CompApp', pill('Finalised', 'green')],
 ['2', '<span style="font-weight: 600;">Ananya Singh</span>', '4 Aug 2011', '3312 8890 xxxx', 'Regular', 'Eng, Hin, Mat, Sci, SSt, Skt', pill('Finalised', 'green')],
 ['3', '<span style="font-weight: 600;">Aditya Pandey</span>', '22 Jan 2011', '<span style="color: #B5372A; font-weight: 600;">Missing</span>', 'Regular', 'Eng, Hin, Mat, Sci, SSt, CompApp', pill('Incomplete', 'red')],
 ['4', '<span style="font-weight: 600;">Bhavya Mishra</span>', '9 Nov 2010', '5540 2213 xxxx', 'Regular', 'Eng, Hin, Mat, Sci, SSt, Skt', pill('Draft', 'gold')],
 ['5', '<span style="font-weight: 600;">Devansh Yadav</span>', '30 May 2011', '7781 0034 xxxx', 'Regular', 'Eng, Hin, Mat, Sci, SSt, CompApp', pill('Draft', 'gold')],
 ['6', '<span style="font-weight: 600;">Ishita Gupta</span>', '15 Sep 2011', '1198 4470 xxxx', 'Regular', 'Eng, Hin, Mat, Sci, SSt, Skt', pill('Finalised', 'green')],
 ['7', '<span style="font-weight: 600;">Kavya Rai</span>', '2 Feb 2011', '9034 7712 xxxx', 'Regular', 'Eng, Hin, Mat, Sci, SSt, CompApp', pill('Draft', 'gold')],
 ['8', '<span style="font-weight: 600;">Nitya Verma</span>', '19 Jul 2011', '4421 6608 xxxx', 'Transfer · CITY', 'Eng, Hin, Mat, Sci, SSt, Skt', pill('Draft', 'gold')],
 ['9', '<span style="font-weight: 600;">Riya Dubey</span>', '8 Dec 2010', '2276 9931 xxxx', 'Regular', '<span style="color: #B5372A; font-weight: 600;">Optional not chosen</span>', pill('Incomplete', 'red')],
], btpl)
body = MAIN(pagehead('Assessment', 'Board candidates', 'CBSE List of Candidates · Class 9 and 11 register, Class 10 and 12 candidates from the roster plus feeder registrations', btn('Export LoC CSV', icon=DL) + btn('Withdraw…') + btn('Finalise 17 drafts', 'primary')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">{seg(['Register (9, 11)', 'Candidates (10, 12)'], 'Candidates (10, 12)')}{select('Session', '2026–27')}{select('Class', 'Class 10 · all sections')}{searchbox('Name / Aadhaar / APAAR', '240px')}<div style="flex: 1;"></div><div style="display: flex; gap: 6px;">{pill('84 candidates', 'muted')}{pill('61 finalised', 'green')}{pill('17 draft', 'gold')}{pill('6 incomplete', 'red')}</div></div>
      {card(cardhead('Class 10 · 2026–27', 'Every finalised row must carry DOB, Aadhaar or APAAR, and a full subject set before export') + thead(['#', 'Candidate', 'Date of birth', 'Aadhaar', 'Category', 'Subjects', 'Status'], btpl) + brows + footer('Showing 9 of 84', 'Incomplete rows are excluded from the CSV until fixed'), 'flex: 1; min-height: 0;')}''')
open('BoardCandidates.dc.html','w').write(shell('Board candidates', body))

# ---------------- RESCHEDULE ----------------
def rrow(t, cls, subj, topic, to, last=False, chk=True):
    box = f'<span style="width: 16px; height: 16px; border-radius: 4px; {"background: #26251F;" if chk else "border: 1.5px solid #DBDAD0; background: #FFFFFF;"} display: inline-flex; align-items: center; justify-content: center;">{"<svg width=\"11\" height=\"11\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#FFFFFF\" stroke-width=\"3\"><polyline points=\"20 6 9 17 4 12\"/></svg>" if chk else ""}</span>'
    return f'<div style="display: grid; grid-template-columns: 30px 180px 80px 110px minmax(0, 1fr) 150px; gap: 12px; padding: 10px 18px; font-size: 12.5px; align-items: center; {"" if last else "border-bottom: 1px solid #F5F5F0;"}"><div>{box}</div><div style="display: flex; align-items: center; gap: 8px;">{avatar(t, s=24)}<span style="font-weight: 600;">{t}</span></div><div>{cls}</div><div style="color: #75746B;">{subj}</div><div style="color: #3B3A32;">{topic}</div><div style="color: #2C4A38; font-weight: 600;">→ {to}</div></div>'
rr = ''.join([rrow('S. K. Pandey','10-A','Mathematics','Quadratic equations · nature of roots','Tue 15 · P3'), rrow('Ritu Singh','8-B','English','Poem: The Road Not Taken','Tue 15 · P3'), rrow('Meera Kumari','5-A','Hindi','Sangya ke bhed','Tue 15 · P3'), rrow('Priya Tiwari','10-B','SSt','Non-cooperation movement','Tue 15 · P3'), rrow('N. Rai','9-A','Science','Mole concept','Tue 15 · P3'), rrow('Kamal Nath','11 Com','Economics','Law of demand','Tue 15 · P4', chk=False), rrow('K. N. Mishra','7-A','Sanskrit','Shabd roop','Tue 15 · P5', chk=False), rrow('D. Yadav','6-A','PE','Athletics · relay practice','Tue 15 · P6', last=True, chk=False)])
body = MAIN(pagehead('Teaching', 'Reschedule lesson plans', 'A lost day or period shifts every affected plan forward · teachers see the new dates in the PWA', btn('Back to selection') + btn('Apply to 5 selected', 'primary')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">{select('Lost day', 'Mon 14 Sep · P3–P8')}{inputbox('', 'Reason · e.g. Election duty, rainy day')}{seg(['Same period', 'Any period'], 'Same period')}<div style="flex: 1;"></div>{btn('Select all')}{btn('Deselect all')}</div>
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px;">
        {card(cardhead('Affected plans · 42', 'Mon 14 Sep, P3 onwards · proposed new slot on the right') + f'<div style="display: grid; grid-template-columns: 30px 180px 80px 110px minmax(0, 1fr) 150px; gap: 12px; padding: 8px 18px; font-size: 10.5px; color: #9C9B90; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; background: #FAFAF7; border-bottom: 1px solid #E9E8E0;"><div></div><div>Teacher</div><div>Class</div><div>Subject</div><div>Planned topic</div><div>Moves to</div></div>' + rr + footer('Showing 8 of 42 · 5 selected', 'Plans already taught (Lesson log) are skipped'), 'min-height: 0;')}
        {card(cardhead('What happens') + '<div style="padding: 12px 18px; display: flex; flex-direction: column; gap: 10px; font-size: 12.5px; color: #3B3A32; line-height: 1.5;"><div style="display: flex; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #3E8E5A; margin-top: 6px; flex-shrink: 0;"></span>Selected plans move to the next slot of the same subject and class.</div><div style="display: flex; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #3E8E5A; margin-top: 6px; flex-shrink: 0;"></span>Later plans in that chain shift by one slot each.</div><div style="display: flex; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #A87E12; margin-top: 6px; flex-shrink: 0;"></span>Mon 14 P3–P8 is marked as a non-working half day.</div><div style="display: flex; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #9C9B90; margin-top: 6px; flex-shrink: 0;"></span>Nothing is deleted; every move is logged with the reason.</div></div>')}
      </div>''')
open('Reschedule.dc.html','w').write(shell('Lesson plans', body))

# ---------------- SCHEDULE SETTINGS (period times + non-working days) ----------------
def prow(p, start, end, mins, kind='Period', last=False):
    return f'<div style="display: grid; grid-template-columns: 90px 90px 90px 70px minmax(0, 1fr); gap: 12px; padding: 8px 18px; font-size: 12.5px; align-items: center; {"" if last else "border-bottom: 1px solid #F5F5F0;"} {"background: #FAFAF7;" if kind!="Period" else ""}"><div style="font-weight: 600;">{p}</div><div style="padding: 4px 8px; border: 1px solid #DBDAD0; border-radius: 7px; background: #FFFFFF; width: 70px;">{start}</div><div style="padding: 4px 8px; border: 1px solid #DBDAD0; border-radius: 7px; background: #FFFFFF; width: 70px;">{end}</div><div style="color: #75746B;">{mins} min</div><div>{pill(kind, "muted" if kind=="Period" else "gold")}</div></div>'
pr = ''.join([prow('P1','08:00','08:45','45'), prow('P2','08:45','09:30','45'), prow('P3','09:30','10:15','45'), prow('Break','10:15','10:30','15','Interval'), prow('P4','10:30','11:15','45'), prow('P5','11:15','12:00','45'), prow('Lunch','12:00','12:30','30','Interval'), prow('P6','12:30','13:15','45'), prow('P7','13:15','14:00','45'), prow('P8','14:00','14:40','40', last=True)])
cal_days = []
for d in range(1, 31):
    wd = d % 7  # Mon=0 … Sun=6; 1 Sep 2026 is a Tuesday
    kind = 'sun' if wd == 6 else ('hol' if d in (5,) else ('half' if d==14 else ('exam' if d in (22,23,24,25,26) else 'ok')))
    bg, fg, bd = {'sun': ('#F5F5F0','#9C9B90',''), 'hol': ('#F6E4E2','#B5372A',''), 'half': ('#F5EBD8','#8A670E',''), 'exam': ('#E7EDF6','#3B6FB5',''), 'ok': ('#FFFFFF','#26251F','border: 1px solid #E9E8E0;')}[kind]
    cal_days.append(f'<div style="height: 44px; border-radius: 8px; background: {bg}; color: {fg}; {bd} display: flex; align-items: flex-start; padding: 6px 8px; font-size: 12px; font-weight: 600;">{d}</div>')
cal = '<div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px;">' + ''.join(f'<div style="text-align: center; font-size: 10.5px; color: #9C9B90; font-weight: 600; text-transform: uppercase;">{d}</div>' for d in ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) + '<div></div>' + ''.join(cal_days) + '</div>'
body = MAIN(pagehead('Schedule', 'Period times &amp; non-working days', 'Per branch · drives the timetable grid, lesson-plan weeks, HRMS lateness and attendance', btn('Reset to equal') + btn('Save changes', 'primary')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">{select('Branch', 'Main')}{seg(['Regular day', 'Winter timing', 'Exam days'], 'Regular day')}<div style="flex: 1;"></div>{legend([('Holiday','#F6E4E2'),('Half day','#F5EBD8'),('Exam','#E7EDF6'),('Sunday','#F5F5F0')])}</div>
      <div style="flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px;">
        {card(cardhead('Period times · Main', '8 periods · school day 08:00–14:40 · Saturday ends after P6') + '<div style="display: grid; grid-template-columns: 90px 90px 90px 70px minmax(0, 1fr); gap: 12px; padding: 8px 18px; font-size: 10.5px; color: #9C9B90; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; background: #FAFAF7; border-bottom: 1px solid #E9E8E0;"><div>Slot</div><div>Starts</div><div>Ends</div><div>Length</div><div>Kind</div></div>' + pr, 'min-height: 0;')}
        {card(cardhead('Non-working days · September 2026', '1 holiday · 1 half day · 5 exam days', btn('Add day', 'ghost', PLUS)) + f'<div style="padding: 14px 18px;">{cal}</div>' + '<div style="padding: 0 18px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px;"><div style="display: flex; justify-content: space-between;"><span><b style="font-weight: 600;">5 Sep</b> · Teachers\' Day (holiday)</span><span style="color: #75746B;">Both branches</span></div><div style="display: flex; justify-content: space-between;"><span><b style="font-weight: 600;">14 Sep</b> · Half day from P3 (rain)</span><span style="color: #75746B;">Main</span></div><div style="display: flex; justify-content: space-between;"><span><b style="font-weight: 600;">22–26 Sep</b> · Half-yearly exams</span><span style="color: #75746B;">Both branches</span></div></div>', 'min-height: 0;')}
      </div>''')
open('ScheduleSettings.dc.html','w').write(shell('Timetable', body))

# ---------------- SETUP HUB ----------------
def stile(title, sub, meta, tone='muted'):
    return f'<div style="background: #FFFFFF; border: 1px solid #E9E8E0; border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; min-height: 120px;"><div style="display: flex; justify-content: space-between; align-items: flex-start;"><div style="font-size: 14px; font-weight: 700;">{title}</div>{pill(meta, tone)}</div><div style="font-size: 12.5px; color: #75746B; line-height: 1.45; flex: 1;">{sub}</div><div style="font-size: 12px; font-weight: 600; color: #3E8E5A;">Open →</div></div>'
tiles = ''.join([
 stile('Sessions &amp; terms', '2026–27 active · Periodic 1, Half-yearly, Periodic 2, Pre-boards, Annual. Active session follows SMS.', 'Synced with SMS', 'green'),
 stile('Classes &amp; sections', 'Nursery–12 across Main (34) and City (28). Streams for 11–12: Science, Commerce, Humanities.', '62 classes'),
 stile('Classes &amp; subjects assignment', 'Which subjects each class takes and who teaches them.', '2 unassigned', 'red'),
 stile('Optional subjects', 'Senior-secondary electives and Class 9–10 optionals: Hindi, PE, Computers, AI.', '4 options'),
 stile('Lesson plan fields', 'Fields teachers fill each week: objectives, activity, assessment plan, homework, remarks.', '5 fields'),
 stile('Report card templates', 'One per class family: Nursery–2, 3–5, 6–8, 9–10, 11–12 · per-subject schemes.', '5 families', 'green'),
 stile('HPC template', 'Domains, levels and prompts for the Holistic Progress Card.', '2026–27 set', 'green'),
 stile('Period times &amp; non-working days', 'School day slots per branch, holidays, half days, exam days.', 'Regular'),
 stile('Impersonate', 'Open the Parent app as a family to check what they see. Super admin only.', 'Super admin', 'ink'),
])
body = MAIN(pagehead('Setup', 'Setup', 'Everything that shapes the session · most of it set once in April, revisited at rollover', btn('Session rollover checklist')) + f'''
      <div style="display: flex; align-items: center; gap: 10px;">{select('Branch', 'Main')}{select('Session', '2026–27')}<div style="flex: 1;"></div><div style="display: flex; gap: 6px;">{pill('2 items need attention', 'red')}</div></div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;">{tiles}</div>
      {card(cardhead('Needs attention') + '<div style="padding: 12px 18px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px;"><div style="display: flex; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #B5372A; margin-top: 5px; flex-shrink: 0;"></span>Class 11 Com · Mathematics has no teacher (Classes &amp; subjects assignment)</div><div style="display: flex; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #B5372A; margin-top: 5px; flex-shrink: 0;"></span>City branch · Class 9–10 subjects not built for 2026–27 (Examinations will have nothing to type)</div></div>', 'flex: 1; min-height: 0;')}''')
open('SetupHub.dc.html','w').write(shell('Setup', body))
print('screens2 ok')
