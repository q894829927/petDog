import { useState, type FormEvent } from "react";
import { personalities, type Personality } from "../../shared/pet";
import { adoptPet, refreshCloud, renamePet, signIn, signOut, useCloudPet } from "../cloud/useCloudPet";

export const personalityLabel: Record<Personality, string> = {
  playful: "活泼",
  affectionate: "黏人",
  reserved: "慢热",
};

export function CloudPanel({ close }: { close: () => void }) {
  const { connected, email, registrationOpen, pet, busy, error } = useCloudPet();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [personality, setPersonality] = useState<Personality>("playful");
  const formKey = email ? email + (pet ? "/profile" : "/adopt") : "credentials";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (!email) {
      await signIn(mode, String(fields.get("email")), String(fields.get("password")));
    } else if (!pet) {
      if (await adoptPet(String(fields.get("name")), personality)) close();
    } else if (await renamePet(String(fields.get("name")))) {
      close();
    }
  };

  return (
    <div className="cloud-content">
      {connected === null ? (
        <p className="cloud-text" role="status">正在连接云端…</p>
      ) : !connected ? (
        <p className="cloud-text">云端服务暂不可用。你可以继续在房间里试玩。</p>
      ) : (
        <>
          {!email && registrationOpen && (
            <div className="segmented" role="group" aria-label="账号操作">
              <button type="button" className={mode === "login" ? "selected" : ""} aria-pressed={mode === "login"} onClick={() => setMode("login")}>登录</button>
              <button type="button" className={mode === "register" ? "selected" : ""} aria-pressed={mode === "register"} onClick={() => setMode("register")}>注册</button>
            </div>
          )}
          <form key={formKey} className="cloud-form" onSubmit={submit}>
            {!email ? (
              <>
                <label>邮箱<input type="email" name="email" autoComplete="username" required maxLength={254} /></label>
                <label>密码<input type="password" name="password" autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required minLength={10} maxLength={128} /></label>
                {mode === "register" && <p className="cloud-text">密码至少 10 个字符。</p>}
                <button type="submit" className="cloud-primary" disabled={busy}>{mode === "register" ? "创建账号" : "登录账号"}</button>
              </>
            ) : (
              <>
                <p className="cloud-email">{email}</p>
                <label>宠物名字<input name="name" required minLength={1} maxLength={24} defaultValue={pet?.name ?? "团子"} /></label>
                {!pet && (
                  <fieldset className="personality-choices">
                    <legend>性格</legend>
                    <div className="segmented">
                      {personalities.map((choice) => (
                        <button type="button" key={choice} className={choice === personality ? "selected" : ""}
                          aria-pressed={choice === personality} onClick={() => setPersonality(choice)}>{personalityLabel[choice]}</button>
                      ))}
                    </div>
                  </fieldset>
                )}
                <button type="submit" className="cloud-primary" disabled={busy}>{pet ? "保存名字" : "领养宠物"}</button>
                <button type="button" className="cloud-secondary" disabled={busy} onClick={() => { void signOut(); }}>退出登录</button>
              </>
            )}
          </form>
        </>
      )}
      {error && connected && <p className="cloud-error" role="alert">{error}</p>}
      {(connected === false || (email && error)) && (
        <button type="button" className="cloud-secondary" disabled={busy} onClick={refreshCloud}>重试同步</button>
      )}
    </div>
  );
}
