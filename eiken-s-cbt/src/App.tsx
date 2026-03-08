import React, { useState, useEffect, useMemo } from 'react';

type QuestionType = 'reading' | 'writing' | 'listening';

interface Question {
  id: string;
  type: QuestionType;
  category: string;
  passage?: string;
  question: string;
  options: string[];
  situation?: string;
}

type AppState = 'input' | 'listening_phase' | 'rw_phase' | 'grading' | 'results';

// Robust Parser for the new format
const parseEikenText = (text: string): Question[] => {
  const sections = text.split(/\[(.*?)\]/);
  const questions: Question[] = [];

  for (let i = 1; i < sections.length; i += 2) {
    const sectionName = sections[i];
    const sectionContent = sections[i + 1];
    if (!sectionContent) continue;

    const isListening = sectionName.toLowerCase().includes('listening');
    const isWriting = sectionName.toLowerCase().includes('writing');
    const type: QuestionType = isListening ? 'listening' : isWriting ? 'writing' : 'reading';

    // Split content by questions (Q(...) or No. ... or Q#)
    const items = sectionContent.split(/(Q\(\d+\)|No\.\s*\d+|Q\d+)/);
    let currentPassage = "";

    // Extract passage/topic before the first question
    if (items[0].match(/Passage:|Article:|TOPIC:/i)) {
      currentPassage = items[0].trim();
    }

    if (items.length <= 1 && isWriting) {
      // Handle Writing sections that don't have a Q number
      questions.push({
        id: sectionName.match(/\d+/) ? sectionName.match(/\d+/)![0] : 'W',
        type,
        category: sectionName,
        passage: currentPassage || (sectionContent.trim()),
        question: "Write your response according to the prompt.",
        options: []
      });
      continue;
    }

    for (let j = 1; j < items.length; j += 2) {
      const qIdRaw = items[j];
      const qIdMatch = qIdRaw.match(/\d+/);
      const qId = qIdMatch ? qIdMatch[0] : `${j}`;
      let qContent = items[j + 1];

      // BUG FIX: If the qContent contains the next "Passage:", "Article:", or "TOPIC:", truncate it.
      const nextPassageMatch = qContent.match(/Passage:|Article:|TOPIC:/i);
      if (nextPassageMatch && nextPassageMatch.index !== undefined) {
        qContent = qContent.substring(0, nextPassageMatch.index);
      }

      let questionText = "";
      let options: string[] = [];
      let situation = "";

      if (isListening && qContent.includes('Situation:')) {
        const sitMatch = qContent.match(/Situation:\s*([\s\S]*?)\s*Question:\s*([\s\S]*?)(?=Options:|$)/i);
        if (sitMatch) {
          situation = sitMatch[1].trim();
          questionText = sitMatch[2].trim();
          const optPart = qContent.split(/Options:/i)[1];
          if (optPart) {
            options = optPart.split(/\/\s*\d+\s+|\n-\s+/).map(s => s.replace(/^\d+\s+|\s*\n/g, '').trim()).filter(s => s);
          }
        } else {
          // Fallback for simple No. style even if Situation text is weird
          const optPart = qContent.split(/Options:/i);
          questionText = optPart[0].trim();
          if (optPart[1]) {
            options = optPart[1].split(/\/\s*\d+\s+|\n-\s+/).map(s => s.replace(/^\d+\s+/g, '').trim()).filter(s => s);
          }
        }
      } else {
        const optPart = qContent.split(/Options:/i);
        questionText = optPart[0].trim();
        if (optPart[1]) {
          // Split by " / 1 " or " / 2 " or " - " or just " / "
          options = optPart[1].split(/\/\s*(?:\d+)?\s+|(?:\d+)\s+/).map(s => s.trim()).filter(s => s);
        }
      }

      questions.push({
        id: qId,
        type,
        category: sectionName,
        passage: currentPassage || undefined,
        question: questionText || (isListening ? "(Listen to the audio)" : ""),
        options: options,
        situation: situation || undefined
      });

      // Update currentPassage if the next question's content or trailing part of this one has a new passage
      const fullNextContent = items[j + 1]; // Use original untruncated content here
      if (fullNextContent.match(/Passage:|Article:|TOPIC:/i)) {
        const parts = fullNextContent.split(/Passage:|Article:|TOPIC:/i);
        if (parts.length > 1) {
          const newPassage = fullNextContent.substring(fullNextContent.search(/Passage:|Article:|TOPIC:/i)).trim();
          // Only update if it's substantial (to avoid catching mid-sentence mentions)
          if (newPassage.length > 50) {
            currentPassage = newPassage.split(/Q\(\d+\)|No\.\s*\d+|Q\d+/)[0];
          }
        }
      }
    }
  }
  return questions;
};

const WordCounter: React.FC<{ text: string }> = ({ text }) => {
  const count = useMemo(() => {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }, [text]);
  return <div className="word-count" style={{ display: 'inline' }}>{count} 語</div>;
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>('input');
  const [rawText, setRawText] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [gradingMarks, setGradingMarks] = useState<Record<string, boolean | number>>({});
  const [timeLeft, setTimeLeft] = useState(90 * 60);
  const [showConfirm, setShowConfirm] = useState(false);
  const [reviewLater, setReviewLater] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showPrintView, setShowPrintView] = useState(false);


  // Phase-specific question lists
  const listeningQs = useMemo(() => questions.filter(q => q.type === 'listening'), [questions]);
  const rwQs = useMemo(() => questions.filter(q => q.type !== 'listening'), [questions]);

  const activeQs = state === 'listening_phase' ? listeningQs : rwQs;
  const currentQuestion = activeQs[currentIdx];

  useEffect(() => {
    let timer: number;
    if (state === 'rw_phase' && timeLeft > 0) {
      timer = window.setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [state, timeLeft]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleStart = () => {
    const parsed = parseEikenText(rawText);
    if (parsed.length > 0) {
      setQuestions(parsed);
      setCurrentIdx(0);
      const hasListening = parsed.some(q => q.type === 'listening');
      setState(hasListening ? 'listening_phase' : 'rw_phase');
    } else {
      alert('Could not find any questions. Please check the format.');
    }
  };

  const handleNextPhase = () => {
    if (state === 'listening_phase') {
      setState('rw_phase');
      setCurrentIdx(0);
    } else {
      setShowConfirm(true);
    }
  };

  const handleManualGrade = (questionId: string, type: string, value: boolean | number | Record<string, number>) => {
    setGradingMarks(prev => ({ ...prev, [`${type}_${questionId}`]: value }));
  };

  const getSectionScore = (type: QuestionType) => {
    const sectionQs = questions.filter(q => q.type === type);
    if (type === 'writing') {
      return sectionQs.reduce((sum, q) => {
        const marks = gradingMarks[`${type}_${q.id}`] as Record<string, number>;
        if (!marks) return sum;
        return sum + (marks.content || 0) + (marks.structure || 0) + (marks.vocab || 0) + (marks.grammar || 0);
      }, 0);
    }
    return sectionQs.filter(q => gradingMarks[`${type}_${q.id}`] === true).length;
  };

  const getTotalPossible = (type: QuestionType) => {
    const sectionQs = questions.filter(q => q.type === type);
    if (type === 'writing') return sectionQs.length * 16;
    return sectionQs.length;
  };

  // PASS FAIL THRESHOLD (Roughly 65%)
  const isPass = useMemo(() => {
    const rScore = getSectionScore('reading');
    const lScore = getSectionScore('listening');
    const wScore = getSectionScore('writing');
    const rTotal = getTotalPossible('reading');
    const lTotal = getTotalPossible('listening');
    const wTotal = getTotalPossible('writing');
    const totalScore = rScore + lScore + wScore;
    const totalPossible = rTotal + lTotal + wTotal;
    return totalPossible > 0 && (totalScore / totalPossible) >= 0.65;
  }, [gradingMarks, questions]);

  // PERSISTENCE: Save results to localStorage
  useEffect(() => {
    if (state === 'results') {
      const resultData = {
        date: new Date().toISOString(),
        gradingMarks,
        answers,
        questions,
        isPass
      };
      localStorage.setItem('eiken_latest_result', JSON.stringify(resultData));
    }
  }, [state, gradingMarks, answers, questions, isPass]);

  if (showPrintView) {
    const wrongQs = questions.filter(q => gradingMarks[`${q.type}_${q.id}`] === false || (q.type === 'writing' && (gradingMarks[`${q.type}_${q.id}`] as number) < 16));
    return (
      <div className="print-view">
        <div className="print-header">
          <h1>英検 S-CBT 復習用練習プリント</h1>
          <button className="no-print btn-nav" onClick={() => setShowPrintView(false)}>戻る</button>
          <button className="no-print btn-finish" onClick={() => window.print()}>印刷する</button>
        </div>
        {wrongQs.map((q, idx) => (
          <div key={idx} className="print-question">
            <h3>【{q.type === 'reading' ? 'リーディング' : q.type === 'listening' ? 'リスニング' : 'ライティング'}】 ({q.id}) {q.category}</h3>
            {q.passage && (
              <div className="print-passage">
                {currentPassageLines(q.passage).map((line, i) => <div key={i}>{line}</div>)}
              </div>
            )}
            <div className="print-q-text">{q.question}</div>
            {q.options.length > 0 && (
              <div className="print-options">
                {q.options.map((opt, i) => <div key={i}>({i + 1}) {opt}</div>)}
              </div>
            )}
            <div className="print-answer-space">
              【解答欄】
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (state === 'input') {
    return (
      <div className="start-screen">
        <div className="glass-card">
          <h1 style={{ textAlign: 'center', marginBottom: '1vh', fontSize: '4vh' }}>英検 S-CBT 模擬試験システム</h1>
          <p style={{ textAlign: 'center', fontSize: '2.2vh', color: '#666', marginBottom: '3vh' }}>
            問題データを貼り付けて「試験を開始する」を押してください。
          </p>
          <textarea
            className="json-textarea"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="[Reading Part1] ..."
            style={{ fontSize: '2vh' }}
          />
          <button className="btn-finish" style={{ marginTop: '3vh' }} onClick={handleStart}>試験を開始する</button>
        </div>
      </div>
    );
  }

  if (state === 'grading') {
    return (
      <div className="modal-overlay">
        <div className="result-card" style={{ width: '95%', height: '90%', overflowY: 'auto', padding: '4vh' }}>
          <h1 style={{ borderBottom: '2px solid #eee', paddingBottom: '2vh', textAlign: 'center' }}>自己採点</h1>
          <p style={{ textAlign: 'center', color: '#666', marginBottom: '4vh' }}>
            選択肢の問題は「正解の番号」を押すと自動で判定されます。<br />
            ライティングは 4つの観点でそれぞれ 1〜4点を選択してください。
          </p>

          <div style={{ marginTop: '4vh' }}>
            {questions.map((q, idx) => {
              const userAns = answers[`${q.type}_${q.id}`];
              const isMarked = gradingMarks[`${q.type}_${q.id}`] !== undefined;
              const isCorrect = gradingMarks[`${q.type}_${q.id}`] === true;

              return (
                <div key={`${q.type}_${q.id}_${idx}`} style={{
                  marginBottom: '4vh',
                  padding: '3vh',
                  borderRadius: '12px',
                  background: '#fff',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
                  display: 'flex',
                  gap: '4vh',
                  borderLeft: isMarked ? (isCorrect || q.type === 'writing' ? '8px solid #28a745' : '8px solid #dc3545') : '8px solid #ccc'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '2vh', marginBottom: '1.5vh', color: '#555' }}>
                      ({q.id}) {q.category}
                    </div>
                    <div style={{ fontSize: '2.2vh', marginBottom: '2vh' }}>{q.question}</div>
                    <div style={{ background: '#f8f9fa', padding: '2vh', borderRadius: '8px', fontSize: '2vh', border: '1px solid #eee' }}>
                      <strong>あなたの回答:</strong> <span style={{ fontSize: '2.4vh', color: '#1e3c72', fontWeight: 800 }}>{userAns || '未回答'}</span>
                    </div>
                    {q.type === 'writing' && userAns && (
                      <div style={{ marginTop: '2vh', whiteSpace: 'pre-wrap', fontStyle: 'italic', borderTop: '1px solid #ddd', paddingTop: '2vh', fontSize: '1.8vh', color: '#444' }}>
                        {userAns}
                      </div>
                    )}
                  </div>

                  <div className="grading-controls" style={{ minWidth: '40vh', display: 'flex', flexDirection: 'column', gap: '1.5vh', justifyContent: 'center' }}>
                    {q.type === 'writing' ? (
                      <div className="writing-grading-grid">
                        {[
                          { key: 'content', label: '内容' },
                          { key: 'structure', label: '構成' },
                          { key: 'vocab', label: '語彙' },
                          { key: 'grammar', label: '文法' }
                        ].map(criteria => {
                          const currentVal = (gradingMarks[`${q.type}_${q.id}`] as Record<string, number>)?.[criteria.key] || 0;
                          return (
                            <div key={criteria.key} className="criteria-row" style={{ display: 'flex', alignItems: 'center', gap: '1.5vh', marginBottom: '1vh' }}>
                              <div style={{ width: '6vh', fontWeight: 700 }}>{criteria.label}</div>
                              <div style={{ display: 'flex', gap: '1vh', flex: 1 }}>
                                {[1, 2, 3, 4].map(pt => (
                                  <button
                                    key={pt}
                                    className={`tool-btn ${currentVal === pt ? 'active-model' : ''}`}
                                    onClick={() => {
                                      const currentMarks = (gradingMarks[`${q.type}_${q.id}`] as Record<string, number>) || {};
                                      handleManualGrade(q.id, q.type, { ...currentMarks, [criteria.key]: pt });
                                    }}
                                    style={{ flex: 1, padding: '1vh', fontSize: '1.8vh' }}
                                  >
                                    {pt}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        <div style={{ marginTop: '1vh', textAlign: 'right', fontWeight: 800, fontSize: '2.2vh', color: '#1e3c72' }}>
                          合計: {Object.values((gradingMarks[`${q.type}_${q.id}`] as Record<string, number>) || {}).reduce((a, b) => a + b, 0)} / 16
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ textAlign: 'center', fontSize: '1.4vh', color: '#888', marginBottom: '0.5vh' }}>模範解答を選択</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1vh' }}>
                          {[1, 2, 3, 4].map(num => (
                            <button
                              key={num}
                              className={`tool-btn ${gradingMarks[`${q.type}_${q.id}`] !== undefined && (userAns === num ? isCorrect : !isCorrect) ? 'active-model' : ''}`}
                              onClick={() => handleManualGrade(q.id, q.type, userAns === num)}
                              style={{ padding: '1.5vh', fontSize: '2vh', fontWeight: 800 }}
                            >
                              {num}
                            </button>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '1vh', marginTop: '1vh' }}>
                          <button
                            className={`toggle-btn correct ${isCorrect === true ? 'active' : ''}`}
                            onClick={() => handleManualGrade(q.id, q.type, true)}
                            style={{ flex: 1, margin: 0 }}
                          >◯ 正解</button>
                          <button
                            className={`toggle-btn incorrect ${isCorrect === false ? 'active' : ''}`}
                            onClick={() => handleManualGrade(q.id, q.type, false)}
                            style={{ flex: 1, margin: 0 }}
                          >✕ 不正解</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ textAlign: 'center', marginTop: '4vh', position: 'sticky', bottom: '0', background: 'rgba(255,255,255,0.9)', padding: '2vh' }}>
            <button className="btn-finish" style={{ width: 'auto', padding: '2vh 10vh', fontSize: '2.5vh', fontWeight: 800, background: '#1e3c72', color: 'white' }} onClick={() => setState('results')}>採点を完了して成績表を表示</button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'results') {
    const rScore = getSectionScore('reading');
    const lScore = getSectionScore('listening');
    const wScore = getSectionScore('writing');
    const rTotal = getTotalPossible('reading');
    const lTotal = getTotalPossible('listening');
    const wTotal = getTotalPossible('writing');

    return (
      <div className="modal-overlay">
        <div className="result-card eiken-certificate" style={{ width: '90%', maxWidth: '1000px', padding: '0', overflowY: 'auto', background: '#fff' }}>
          {/* Certificate Header Decor */}
          <div className="certificate-border-container">
            <div className="cert-inner-body">
              <div className="cert-top-area">
                <div className="cert-logo">EIKEN S-CBT</div>
                <div className="cert-exam-name">実用英語技能検定 準1級</div>
                <div className="cert-title-jp">成績証明書（模擬演習）</div>
              </div>

              <div className="cert-main-grid">
                <div className="cert-left-panel">
                  <div className="pass-fail-seal-container">
                    <div className={`pass-fail-seal ${isPass ? 'pass' : 'fail'}`}>
                      {isPass ? '合格' : '不合格'}
                    </div>
                  </div>
                  <div className="total-score-summary">
                    <div className="summary-label">総合点</div>
                    <div className="summary-value">{rScore + lScore + wScore} <span>/ {rTotal + lTotal + wTotal}</span></div>
                  </div>
                </div>

                <div className="cert-right-panel">
                  <table className="cert-score-table">
                    <thead>
                      <tr>
                        <th>技能</th>
                        <th>得点 / 満点</th>
                        <th>比率</th>
                        <th>推移</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Reading</td>
                        <td className="score-cell">{rScore} / {rTotal}</td>
                        <td>{Math.round((rScore / rTotal) * 100 || 0)}%</td>
                        <td><div className="progress-bar-small"><div className="bar" style={{ width: `${(rScore / rTotal) * 100}%` }}></div></div></td>
                      </tr>
                      <tr>
                        <td>Listening</td>
                        <td className="score-cell">{lScore} / {lTotal}</td>
                        <td>{Math.round((lScore / lTotal) * 100 || 0)}%</td>
                        <td><div className="progress-bar-small"><div className="bar" style={{ width: `${(lScore / lTotal) * 100}%` }}></div></div></td>
                      </tr>
                      <tr>
                        <td>Writing</td>
                        <td className="score-cell">{wScore} / {wTotal}</td>
                        <td>{Math.round((wScore / wTotal) * 100 || 0)}%</td>
                        <td><div className="progress-bar-small"><div className="bar" style={{ width: `${(wScore / wTotal) * 100}%`, background: '#c69c6d' }}></div></div></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Writing Criteria Detail */}
              <div className="writing-detail-section">
                <div className="detail-title">ライティング観点別判定</div>
                <div className="criteria-grid-cert">
                  {questions.filter(q => q.type === 'writing').map((q, idx) => {
                    const marks = (gradingMarks[`${q.type}_${q.id}`] as Record<string, number>) || {};
                    return (
                      <div key={idx} className="cert-writing-q-box">
                        <div className="q-label">Question {q.id} ({q.category})</div>
                        <div className="criteria-scores">
                          <span>内容: {marks.content || 0}</span>
                          <span>構成: {marks.structure || 0}</span>
                          <span>語彙: {marks.vocab || 0}</span>
                          <span>文法: {marks.grammar || 0}</span>
                          <span className="q-total">計: {(marks.content || 0) + (marks.structure || 0) + (marks.vocab || 0) + (marks.grammar || 0)}/16</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="cert-footer">
                <div className="cert-footer-info">
                  実施日: {new Date().toLocaleDateString('ja-JP')} | Antigravity Eiken Simulator
                </div>
                <div className="cert-stamps">
                  <div className="stamp">検定印</div>
                </div>
              </div>
            </div>
          </div>

          <div className="no-print cert-actions" style={{ padding: '2vh', background: '#f5f5f5', borderTop: '1px solid #ddd', textAlign: 'center', display: 'flex', gap: '2vh', justifyContent: 'center' }}>
            <button className="btn-premium" onClick={() => window.print()}>
              成績表をダウンロード (PDF)
            </button>
            <button className="btn-premium secondary" onClick={() => setShowPrintView(true)}>
              練習プリントを出力
            </button>
            <button className="btn-premium secondary" onClick={() => window.location.reload()}>
              トップに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      <header className="s-cbt-header">
        <div className="grade-title-area">Grade Pre-1</div>
        <div className="exam-title">
          {state === 'listening_phase' ? 'リスニングテスト' : '筆記試験（リーディングテスト／ライティングテスト）'}
        </div>
        <div className="timer-area">
          <span style={{ marginRight: '1vh', opacity: 0.8 }}>{state === 'listening_phase' ? 'リスニング' : '筆記'} 残り時間</span>
          <span>{formatTime(timeLeft)}</span>
        </div>
      </header>

      <main className="main-container">
        <div className="content-area">
          {/* Top Navigation */}
          <div className="nav-pos-top">
            <div className="overlay-nav">
              <button
                className="s-cbt-btn"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx(currentIdx - 1)}
              >
                ▲ 前の問題へ
              </button>
            </div>
          </div>

          {currentQuestion ? (
            <>
              {currentQuestion.type === 'listening' ? (
                <div className="listening-view">
                  <div style={{ backgroundColor: '#e0e0e0', padding: '2vh', borderRadius: '8px', marginBottom: '2vh', display: 'flex', alignItems: 'center' }}>
                    <div style={{ background: '#999', color: 'white', padding: '1vh 2vh', borderRadius: '20px', marginRight: '2vh', fontWeight: 'bold', fontSize: '1.8vh' }}>{currentQuestion.category}</div>
                    <div style={{ fontSize: '2vh', fontWeight: 500 }}>{currentQuestion.question || "対話を聞き、問いに対する最も適切なものを一つ選びなさい。"}</div>
                  </div>
                  <div className="listening-main-content">
                    <div className="q-num-big">No.{currentQuestion.id}</div>
                    <div className="listening-options-box">
                      {currentQuestion.options.length > 0 ? currentQuestion.options.map((opt, i) => (
                        <button
                          key={i}
                          className={`listening-btn ${answers[`${currentQuestion.type}_${currentQuestion.id}`] === i + 1 ? 'active' : ''}`}
                          onClick={() => setAnswers({ ...answers, [`${currentQuestion.type}_${currentQuestion.id}`]: i + 1 })}
                        >
                          <span className="opt-num">{i + 1}</span>
                          <span className="opt-text">{opt}</span>
                        </button>
                      )) : [1, 2, 3, 4].map(num => (
                        <button
                          key={num}
                          className={`listening-btn ${answers[`${currentQuestion.type}_${currentQuestion.id}`] === num ? 'active' : ''}`}
                          onClick={() => setAnswers({ ...answers, [`${currentQuestion.type}_${currentQuestion.id}`]: num })}
                        >
                          {num}
                        </button>
                      ))}
                      <div className="review-checkbox-area" style={{ marginTop: '4vh' }}>
                        <input
                          type="checkbox"
                          id={`review-${currentQuestion.id}`}
                          checked={!!reviewLater[`${currentQuestion.type}_${currentQuestion.id}`]}
                          onChange={(e) => setReviewLater({ ...reviewLater, [`${currentQuestion.type}_${currentQuestion.id}`]: e.target.checked })}
                        />
                        <label htmlFor={`review-${currentQuestion.id}`}>目印をつける</label>
                      </div>
                    </div>
                  </div>
                </div>
              ) : currentQuestion.type === 'writing' ? (
                <div className="writing-single-view">
                  <div className="writing-prompt-area" style={{ backgroundColor: '#f9f9f9', padding: '3vh', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '2vh' }}>
                    <div style={{ fontSize: '2vh', lineHeight: '1.6', fontWeight: 500 }}>
                      {currentPassageLines(currentQuestion.passage || "").map((line, i) => <div key={i} style={{ marginBottom: '1vh' }}>{line}</div>)}
                    </div>
                  </div>
                  <div className="writing-input-area" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div className="word-count-display">
                      <WordCounter text={answers[`${currentQuestion.type}_${currentQuestion.id}`] as string || ''} />
                    </div>
                    <textarea
                      className="writing-textarea"
                      style={{ flex: 1, minHeight: '35vh', resize: 'vertical' }}
                      value={answers[`${currentQuestion.type}_${currentQuestion.id}`] as string || ''}
                      onChange={(e) => setAnswers({ ...answers, [`${currentQuestion.type}_${currentQuestion.id}`]: e.target.value })}
                      placeholder="Type your essay here..."
                    />
                    <div className="tool-header" style={{ justifyContent: 'flex-end', marginTop: '1vh', border: 'none', background: 'transparent' }}>
                      <button className="tool-btn">コピー</button>
                      <button className="tool-btn">貼り付け</button>
                      <button className="tool-btn">全体参照</button>
                      <div className="review-checkbox-area" style={{ margin: 0, paddingLeft: '2vh', border: 0 }}>
                        <input
                          type="checkbox"
                          id={`review-${currentQuestion.id}`}
                          checked={!!reviewLater[`${currentQuestion.type}_${currentQuestion.id}`]}
                          onChange={(e) => setReviewLater({ ...reviewLater, [`${currentQuestion.type}_${currentQuestion.id}`]: e.target.checked })}
                        />
                        <label htmlFor={`review-${currentQuestion.id}`}>あとで見直す</label>
                      </div>
                    </div>
                  </div>
                </div>
              ) : currentQuestion.passage ? (
                <div className="split-view">
                  <div className="passage-pane">
                    <div className="passage-content">
                      {currentPassageLines(currentQuestion.passage).map((line, i) => (
                        <div key={i} style={{ marginBottom: '1.5vh', textAlign: line.match(/^[A-Z\s,.]+$/) ? 'center' : 'left', fontWeight: line.match(/^[A-Z\s,.]+$/) ? 700 : 400 }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="question-pane">
                    <div className="question-text" style={{ marginBottom: '3vh', fontSize: '2.2vh', fontWeight: 600 }}>
                      ({currentQuestion.id}) {currentQuestion.question}
                    </div>
                    <div className="options-area">
                      {currentQuestion.options.map((opt, i) => (
                        <div key={i} className="option-row" onClick={() => setAnswers({ ...answers, [`${currentQuestion.type}_${currentQuestion.id}`]: i + 1 })}>
                          <div className={`option-box ${answers[`${currentQuestion.type}_${currentQuestion.id}`] === i + 1 ? 'selected' : ''}`}>
                            {i + 1}
                          </div>
                          <span className="opt-text-reading">{opt}</span>
                        </div>
                      ))}
                    </div>
                    <div className="review-checkbox-area">
                      <input
                        type="checkbox"
                        id={`review-${currentQuestion.id}`}
                        checked={!!reviewLater[`${currentQuestion.type}_${currentQuestion.id}`]}
                        onChange={(e) => setReviewLater({ ...reviewLater, [`${currentQuestion.type}_${currentQuestion.id}`]: e.target.checked })}
                      />
                      <label htmlFor={`review-${currentQuestion.id}`}>あとで見直す</label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="single-pane-view">
                  <div className="question-text" style={{ fontSize: '2.5vh', marginBottom: '5vh', fontWeight: 600 }}>
                    ({currentQuestion.id}) {currentQuestion.question}
                  </div>
                  <div className="options-area" style={{ maxWidth: '700px' }}>
                    {currentQuestion.options.map((opt, i) => (
                      <div key={i} className="option-row" onClick={() => setAnswers({ ...answers, [`${currentQuestion.type}_${currentQuestion.id}`]: i + 1 })}>
                        <div className={`option-box ${answers[`${currentQuestion.type}_${currentQuestion.id}`] === i + 1 ? 'selected' : ''}`}>
                          {i + 1}
                        </div>
                        <span className="opt-text-reading">{opt}</span>
                      </div>
                    ))}
                  </div>
                  <div className="review-checkbox-area" style={{ marginTop: 'auto', paddingTop: '4vh' }}>
                    <input
                      type="checkbox"
                      id={`review-${currentQuestion.id}`}
                      checked={!!reviewLater[`${currentQuestion.type}_${currentQuestion.id}`]}
                      onChange={(e) => setReviewLater({ ...reviewLater, [`${currentQuestion.type}_${currentQuestion.id}`]: e.target.checked })}
                    />
                    <label htmlFor={`review-${currentQuestion.id}`}>あとで見直す</label>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', marginTop: '10vh' }}>問題が読み込まれていません。</div>
          )}

          {/* Bottom Navigation */}
          <div className="nav-pos-bottom" style={{ display: 'flex', gap: '2vh' }}>
            {currentIdx < activeQs.length - 1 ? (
              <div className="overlay-nav">
                <button
                  className="s-cbt-btn"
                  onClick={() => setCurrentIdx(currentIdx + 1)}
                >
                  次の問題へ ▼
                </button>
              </div>
            ) : (
              <div className="overlay-nav">
                <button
                  className="s-cbt-btn"
                  style={{ background: '#28a745', color: '#fff', border: 'none', fontWeight: 800 }}
                  onClick={handleNextPhase}
                >
                  {state === 'listening_phase' ? 'リスニング試験を終了して次へ ▶' : '試験を終了する ▶'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Toggle Button */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            style={{ position: 'absolute', right: '2vh', top: '15vh', zIndex: 100, background: '#1e3c72', color: 'white', border: 'none', padding: '1vh 2vh', borderRadius: '4px', cursor: 'pointer', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}
          >
            ◀ 解答欄を開く
          </button>
        )}

        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>あなたの解答</span>
              <button
                onClick={() => setSidebarOpen(false)}
                style={{ background: 'transparent', color: 'white', border: '1px solid rgba(255,255,255,0.5)', borderRadius: '4px', cursor: 'pointer', padding: '0.5vh 1vh', fontSize: '1.2vh' }}
              >
                閉じる ▶
              </button>
            </div>
            <div className="question-status-list">
              {Object.entries(activeQs.reduce((acc, q) => {
                if (!acc[q.category]) acc[q.category] = [];
                acc[q.category].push(q);
                return acc;
              }, {} as Record<string, Question[]>)).map(([category, groupQs], groupIdx) => {
                const firstQ = groupQs[0];
                const lastQ = groupQs[groupQs.length - 1];
                return (
                  <div key={category} className="range-group">
                    <div className="range-header">
                      <div style={{ background: '#777', color: 'white', borderRadius: '50%', width: '2.5vh', height: '2.5vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2vh' }}>
                        {groupIdx + 1}
                      </div>
                      <span>({firstQ.id})</span>
                      {groupQs.length > 1 && (
                        <>
                          <span>-</span>
                          <span>({lastQ.id})</span>
                        </>
                      )}
                    </div>
                    <div className="range-content">
                      {groupQs.map((q) => (
                        <div key={q.id} className="q-sidebar-row">
                          <span className="q-num-label" onClick={() => setCurrentIdx(activeQs.indexOf(q))}>
                            ({q.id})
                          </span>
                          <div className="sidebar-bubbles">
                            {q.type === 'writing' ? (
                              <div className={`bubble writing-bubble ${answers[`${q.type}_${q.id}`] ? 'active' : ''}`}>
                                {answers[`${q.type}_${q.id}`] ? '解答済' : <span style={{ color: '#888' }}>未解答</span>}
                              </div>
                            ) : (
                              Array.from({ length: 4 }, (_, i) => i + 1).map(num => (
                                <div
                                  key={num}
                                  className={`bubble ${answers[`${q.type}_${q.id}`] === num ? 'active' : ''}`}
                                  onClick={() => setAnswers({ ...answers, [`${q.type}_${q.id}`]: num })}
                                >
                                  {num}
                                </div>
                              ))
                            )}
                          </div>
                          {reviewLater[`${q.type}_${q.id}`] && (
                            <span style={{ background: '#ffff00', color: '#000', fontSize: '1vh', padding: '0.2vh 0.5vh', borderRadius: '2px', fontWeight: 700, marginLeft: '0.5vh', border: '1px solid #000' }}>あとで</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="btn-finish-sidebar" onClick={handleNextPhase}>
              {state === 'listening_phase' ? 'リスニング試験を終了して次へ' : '筆記試験を終了して試験終了'}
            </button>
          </aside>
        )}
      </main>


      {showConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ color: '#000', fontSize: '3.5vh', fontWeight: 800 }}>試験を終了しますか？</h2>
            <p style={{ fontSize: '2.2vh', margin: '3vh 0', color: '#333' }}>一度終了すると、解答を修正することはできません。</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '4vh' }}>
              <button className="btn-nav" style={{ minWidth: '15vh', background: '#eee' }} onClick={() => setShowConfirm(false)}>いいえ</button>
              <button className="btn-finish" style={{ marginTop: 0, width: '15vh', boxShadow: 'none' }} onClick={() => { setShowConfirm(false); setState('grading'); }}>はい（終了）</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const currentPassageLines = (passage: string) => {
  return passage.split('\n');
};

export default App;
