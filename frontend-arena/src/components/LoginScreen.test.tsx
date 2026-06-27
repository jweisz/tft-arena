import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LoginScreen } from "./LoginScreen";

describe("LoginScreen", () => {
  it("calls onLogin with a normalized auth session", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "token-123",
        token_type: "bearer",
        user: { email: "local_dev@localhost" },
      }),
      headers: new Headers({ "content-type": "application/json" }),
      status: 200,
    } as Response);

    render(<LoginScreen onLogin={onLogin} />);

    await user.click(screen.getByRole("button", { name: /enter the arena/i }));

    expect(onLogin).toHaveBeenCalledWith({
      accessToken: "token-123",
      tokenType: "bearer",
      user: { email: "local_dev@localhost" },
      mode: "jwt",
    });
    expect(onLogin).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});
