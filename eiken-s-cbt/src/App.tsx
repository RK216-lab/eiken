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
        passage: currentPassage || sectionContent.trim(),
        question: "Write your response according to the prompt.",
        options: []
      });
      continue;
    }

    for (let j = 1; j < items.length; j += 2) {
      const qIdRaw = items[j];
      const qIdMatch = qIdRaw.match(/\d+/);
      const qId = qIdMatch ? qIdMatch[0] : `${j}`;
      const qContent = items[j + 1];

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
  const [gradingMarks, setGradingMarks] = useState<Record<string, boolean>>({});
  const [timeLeft, setTimeLeft] = useState(90 * 60);
  const [showConfirm, setShowConfirm] = useState(false);
  const [reviewLater, setReviewLater] = useState<Record<string, boolean>>({});

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

  const handleManualGrade = (questionId: string, type: string, isCorrect: boolean) => {
    setGradingMarks(prev => ({ ...prev, [`${type}_${questionId}`]: isCorrect }));
  };

  if (state === 'input') {
    return (
      <div className="start-screen">
        <div className="glass-card">
          <h1 style={{ textAlign: 'center', marginBottom: '1vh', fontSize: '4vh' }}>英検 S-CBT 準1級 模擬試験</h1>
          <p style={{ textAlign: 'center', fontSize: '1.8vh', color: '#666', marginBottom: '3vh' }}>
            下部のテキストエリアに問題データを貼り付けてください。
          </p>
          <textarea
            className="json-textarea"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="[Reading Part1] ..."
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
          <p style={{ textAlign: 'center', color: '#666' }}>すべての問題に◯（正解）または✕（不正解）をつけてください。</p>

          <div style={{ marginTop: '4vh' }}>
            {questions.map((q, idx) => (
              <div key={`${q.type}_${q.id}_${idx}`} style={{
                marginBottom: '4vh',
                padding: '3vh',
                borderRadius: '12px',
                background: '#fff',
                boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
                display: 'flex',
                gap: '4vh'
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '2vh', marginBottom: '1.5vh', color: '#555' }}>
                    ({q.id}) {q.category}
                  </div>
                  <div style={{ fontSize: '2.2vh', marginBottom: '2vh' }}>{q.question}</div>
                  <div style={{ background: '#f8f9fa', padding: '2vh', borderRadius: '8px', fontSize: '2vh' }}>
                    <strong>あなたの回答:</strong> {answers[`${q.type}_${q.id}`] || '未回答'}
                  </div>
                  {q.type === 'writing' && answers[`${q.type}_${q.id}`] && (
                    <div style={{ marginTop: '2vh', whiteSpace: 'pre-wrap', fontStyle: 'italic', borderTop: '1px solid #ddd', paddingTop: '2vh' }}>
                      {answers[`${q.type}_${q.id}`]}
                    </div>
                  )}
                </div>
                <div className="manual-toggle" style={{ flexDirection: 'column', justifyContent: 'center', minWidth: '18vh' }}>
                  <button
                    className={`toggle-btn correct ${gradingMarks[`${q.type}_${q.id}`] === true ? 'active' : ''}`}
                    onClick={() => handleManualGrade(q.id, q.type, true)}
                  >
                    ◯ 正解
                  </button>
                  <button
                    className={`toggle-btn incorrect ${gradingMarks[`${q.type}_${q.id}`] === false ? 'active' : ''}`}
                    onClick={() => handleManualGrade(q.id, q.type, false)}
                  >
                    ✕ 不正解
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: '4vh' }}>
            <button className="btn-finish" style={{ width: 'auto', padding: '2vh 10vh' }} onClick={() => setState('results')}>採点を完了して成績表を表示</button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'results') {
    const correctCount = Object.values(gradingMarks).filter(v => v === true).length;
    const wrongCount = Object.values(gradingMarks).filter(v => v === false).length;

    return (
      <div className="modal-overlay">
        <div className="result-card" style={{ width: '85%', maxWidth: '1000px', textAlign: 'center' }}>
          <h1 style={{ color: '#1e3c72', fontSize: '4vh' }}>試験結果レポート</h1>
          <div style={{ display: 'flex', gap: '4vh', margin: '5vh 0' }}>
            <div className="score-badge" style={{ borderTopColor: '#28a745' }}>
              <div style={{ fontSize: '1.8vh', fontWeight: 600 }}>正解数</div>
              <div style={{ fontSize: '6vh', fontWeight: 800 }}>{correctCount}</div>
            </div>
            <div className="score-badge" style={{ borderTopColor: '#dc3545' }}>
              <div style={{ fontSize: '1.8vh', fontWeight: 600 }}>不正解・見直し</div>
              <div style={{ fontSize: '6vh', fontWeight: 800 }}>{wrongCount}</div>
            </div>
          </div>

          <div style={{ textAlign: 'left', marginTop: '4vh' }}>
            <h2 style={{ borderBottom: '2px solid #1e3c72', paddingBottom: '1vh', display: 'flex', alignItems: 'center', gap: '1.5vh' }}>
              <span>復習リスト</span>
            </h2>
            <div style={{ maxHeight: '40vh', overflowY: 'auto', marginTop: '2vh', paddingRight: '2vh' }}>
              {questions.filter(q => gradingMarks[`${q.type}_${q.id}`] === false).map((q, idx) => (
                <div key={`${q.type}_${q.id}_${idx}`} style={{ padding: '2vh', background: '#fff1f0', borderRadius: '8px', marginBottom: '1.5vh', border: '1px solid #ffa39e' }}>
                  <strong>({q.id}) {q.category}</strong>: {q.question.substring(0, 100)}...
                </div>
              ))}
              {questions.filter(q => gradingMarks[`${q.type}_${q.id}`] === false).length === 0 && <p>すべての問題に正解しました！</p>}
            </div>

            <div style={{ marginTop: '5vh' }}>
              <h2 style={{ borderBottom: '2px solid #1e3c72', paddingBottom: '1vh' }}>ライティング回答内容</h2>
              {questions.filter(q => q.type === 'writing').map((q, idx) => (
                <div key={`${q.type}_${q.id}_${idx}`} style={{ marginTop: '2vh', padding: '3vh', background: '#f8f9fa', borderRadius: '12px', whiteSpace: 'pre-wrap', fontFamily: 'serif', fontSize: '2.2vh', border: '1px solid #ddd' }}>
                  {answers[`${q.type}_${q.id}`] || '(回答なし)'}
                </div>
              ))}
            </div>
          </div>

          <button className="btn-nav" style={{ marginTop: '6vh', padding: '2vh 5vh' }} onClick={() => window.location.reload()}>新しい試験を開始</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      <header className="s-cbt-header">
        <div className="grade-title-area">Grade Pre-1</div>
        <div className="exam-title">
          筆記試験（リーディングテスト／ライティングテスト）
        </div>
        <div className="timer-area">
          <span style={{ marginRight: '1vh', opacity: 0.8 }}>筆記試験 残り時間</span>
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
                <div className="listening-view" style={{ padding: '4vh', display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ backgroundColor: '#e0e0e0', padding: '2vh', borderRadius: '8px', marginBottom: '2vh', display: 'flex', alignItems: 'center' }}>
                    <div style={{ background: '#999', color: 'white', padding: '1vh 2vh', borderRadius: '20px', marginRight: '2vh', fontWeight: 'bold', fontSize: '1.8vh' }}>{currentQuestion.category}</div>
                    <div style={{ fontSize: '2vh', fontWeight: 500 }}>{currentQuestion.question || "対話を聞き、その最後の文に対する応答として最も適切なものを、放送される選択肢の中から一つ選びなさい。"}</div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', marginTop: '2vh' }}>
                    <div style={{ marginRight: '4vh', fontSize: '2.5vh', fontWeight: 'bold' }}>No.{currentQuestion.id}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2vh', flex: 1, maxWidth: '400px' }}>
                      {currentQuestion.options.length > 0 ? currentQuestion.options.map((_, i) => (
                        <button
                          key={i}
                          className={`listening-btn ${answers[`${currentQuestion.type}_${currentQuestion.id}`] === i + 1 ? 'active' : ''}`}
                          onClick={() => setAnswers({ ...answers, [`${currentQuestion.type}_${currentQuestion.id}`]: i + 1 })}
                        >
                          {i + 1}
                        </button>
                      )) : [1, 2, 3].map(num => (
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
                    <div style={{ fontSize: '1.8vh', lineHeight: '1.6' }}>
                      {currentPassageLines(currentQuestion.passage || "").map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                  </div>
                  <div className="writing-input-area" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div className="word-count-display">
                      <WordCounter text={answers[`${currentQuestion.type}_${currentQuestion.id}`] as string || ''} />
                    </div>
                    <textarea
                      className="writing-textarea"
                      style={{ flex: 1, minHeight: '30vh', resize: 'vertical' }}
                      value={answers[`${currentQuestion.type}_${currentQuestion.id}`] as string || ''}
                      onChange={(e) => setAnswers({ ...answers, [`${currentQuestion.type}_${currentQuestion.id}`]: e.target.value })}
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
                    <div className="passage-content" style={{ fontSize: '2.2vh', lineHeight: '1.6' }}>
                      {currentPassageLines(currentQuestion.passage).map((line, i) => (
                        <div key={i} style={{ marginBottom: '1vh', textAlign: line.match(/^[A-Z\s]+$/) ? 'center' : 'left', fontWeight: line.match(/^[A-Z\s]+$/) ? 700 : 400 }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="question-pane">
                    <div className="question-text" style={{ marginBottom: '2vh', fontSize: '2vh' }}>
                      ({currentQuestion.id}) {currentQuestion.question}
                    </div>
                    <div className="options-area">
                      {currentQuestion.options.map((opt, i) => (
                        <div key={i} className="option-row" onClick={() => setAnswers({ ...answers, [`${currentQuestion.type}_${currentQuestion.id}`]: i + 1 })}>
                          <div className={`option-box ${answers[`${currentQuestion.type}_${currentQuestion.id}`] === i + 1 ? 'selected' : ''}`}>
                            {i + 1}
                          </div>
                          <span style={{ fontSize: '1.8vh' }}>{opt}</span>
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
                  <div className="question-text" style={{ fontSize: '2vh', marginBottom: '4vh' }}>
                    ({currentQuestion.id}) {currentQuestion.question}
                  </div>
                  <div className="options-area" style={{ maxWidth: '600px', marginLeft: '2vh' }}>
                    {currentQuestion.options.map((opt, i) => (
                      <div key={i} className="option-row" onClick={() => setAnswers({ ...answers, [`${currentQuestion.type}_${currentQuestion.id}`]: i + 1 })}>
                        <div className={`option-box ${answers[`${currentQuestion.type}_${currentQuestion.id}`] === i + 1 ? 'selected' : ''}`}>
                          {i + 1}
                        </div>
                        <span style={{ fontSize: '1.8vh' }}>{opt}</span>
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
          <div className="nav-pos-bottom">
            <div className="overlay-nav">
              <button
                className="s-cbt-btn"
                disabled={currentIdx === activeQs.length - 1}
                onClick={() => setCurrentIdx(currentIdx + 1)}
              >
                次の問題へ ▼
              </button>
            </div>
          </div>
        </div>

        <aside className="sidebar">
          <div className="sidebar-header">あなたの解答</div>
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
                            Array.from({ length: q.type === 'listening' ? 3 : 4 }, (_, i) => i + 1).map(num => (
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
