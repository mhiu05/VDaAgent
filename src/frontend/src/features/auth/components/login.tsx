'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { z } from 'zod';
import { SetupSchema, type Role, type Session } from '@vda/contracts';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { errorMessage } from '../../../lib/http/api-client';
import { loginWithDevelopmentRole, loginWithPassword } from '../api/session';

type Setup = z.infer<typeof SetupSchema>;

const developmentRoles: Array<{ role: Role; label: string; description: string }> = [
  { role: 'owner', label: 'Chủ sở hữu', description: 'Có quyền quản lý và cập nhật workspace.' },
  { role: 'analyst', label: 'Chuyên viên phân tích', description: 'Phân tích, nhập và cập nhật dữ liệu.' },
  { role: 'viewer', label: 'Người xem', description: 'Chỉ xem dữ liệu và báo cáo.' },
];

export function Login({
  setup,
  error: initialError,
  onRetry,
  onLogin,
}: {
  setup: Setup | null;
  error: string;
  onRetry: () => Promise<void>;
  onLogin: (session: Session) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(body: { email: string; password: string }) {
    setBusy(true);
    setError('');
    try {
      onLogin(await loginWithPassword(body));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function loginAsRole(role: Role) {
    setBusy(true);
    setError('');
    try {
      onLogin(await loginWithDevelopmentRole(role));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Link className="brand" href="/">
          <span className="brand-mark">V</span>
          <span>
            VDaAgent<span className="brand-sub">SAKURA SIGNAL · DATA STUDIO</span>
          </span>
        </Link>
        <div className="login-story-content">
          <span className="eyebrow">TỪ DỮ LIỆU ĐẾN QUYẾT ĐỊNH</span>
          <h1>
            Nhận định rõ ràng.
            <br />
            Bằng chứng truy vết được.
          </h1>
          <p>Hiểu tồn kho, theo dõi sản phẩm chậm luân chuyển và tạo báo cáo có căn cứ.</p>
          <div className="truth-chain">
            Dữ liệu <ArrowRight size={14} /> Phân tích <ArrowRight size={14} /> Bằng chứng{' '}
            <ArrowRight size={14} /> Nhận định <ArrowRight size={14} /> Báo cáo
          </div>
        </div>
        <div className="login-mascot" aria-hidden="true">
          <Image
            src="/brand/mascot/navigator-hero.webp"
            alt=""
            width={768}
            height={922}
            sizes="(max-width: 720px) 150px, (max-width: 1100px) 260px, 360px"
            priority
          />
        </div>
        <div className="login-story-footer">
          <ShieldCheck size={18} /> Dữ liệu được phân tách theo workspace
        </div>
      </section>
      <section className="login-panel">
        <div className="login-box">
          <span className="eyebrow">KHÔNG GIAN LÀM VIỆC</span>
          <h2>Bắt đầu khám phá</h2>
          <p className="muted">
            {setup?.development_role_bypass
              ? 'Chọn vai trò để mở workspace ngay.'
              : 'Đăng nhập để mở không gian phân tích của bạn.'}
          </p>
          {setup && (
            <div className="notice">
              <Sparkles size={18} />
              <div>
                <strong>
                  {setup.development_role_bypass ? 'Chế độ development' : 'Supabase workspace'}
                </strong>
                <p>{setup.message}</p>
                <p>
                  Nhận định qua {setup.llm_primary_provider === 'gemini' ? 'Gemini' : 'OpenAI'}
                  {' · '}dự phòng {setup.llm_fallback_provider === 'openai' ? 'OpenAI' : 'Gemini'}
                </p>
              </div>
            </div>
          )}
          {(initialError || error) && (
            <div className="error-box" role="alert">
              {error || initialError}
            </div>
          )}
          {!setup ? (
            <button className="primary" onClick={() => void onRetry()}>
              Thử kết nối lại
            </button>
          ) : setup.development_role_bypass ? (
            <div className="role-login" aria-label="Chọn vai trò phát triển">
              {developmentRoles.map(({ role, label, description }) => (
                <button
                  key={role}
                  className="secondary full-width"
                  disabled={busy || !setup.ready}
                  onClick={() => void loginAsRole(role)}
                >
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void login({ email, password });
              }}
              className="login-form"
            >
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                Mật khẩu
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button className="primary full-width" disabled={busy || !setup.ready}>
                {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
                <ArrowRight size={17} />
              </button>
            </form>
          )}
          <p className="login-disclaimer">
            Giả định tạm thời cho MVP
            <br />
            Công thức ngữ nghĩa chưa được chuyên viên nghiệp vụ hoặc chủ sở hữu dữ liệu phê duyệt.
          </p>
        </div>
      </section>
    </main>
  );
}
