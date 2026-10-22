import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:5000"
).replace(/\/$/, "");

const TOKEN_KEY = "miniledger_token";

type Loan = {
  id: number;
  friend_name: string;
  amount: string | number;
  due_date: string;
  is_repaid: boolean;
  is_overdue?: boolean;
};

type Summary = {
  total_lent: string | number;
  total_repaid: string | number;
  overdue_amount: string | number;
};

const emptySummary: Summary = {
  total_lent: 0,
  total_repaid: 0,
  overdue_amount: 0,
};

function money(value: string | number) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [phone, setPhone] = useState("+919876543210");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">(
    "success"
  );

  const [loans, setLoans] = useState<Loan[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);

  const [showForm, setShowForm] = useState(false);
  const [friendName, setFriendName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");

  function notify(text: string, type: "success" | "error" = "success") {
    setMessage(text);
    setMessageType(type);
    if (type === "error") console.error(text);
  }

  const apiRequest = useCallback(
    async (
      path: string,
      options: RequestInit = {},
      authToken?: string
    ) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      try {
        const response = await fetch(`${API}${path}`, {
          ...options,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(authToken
              ? { Authorization: `Bearer ${authToken}` }
              : {}),
            ...options.headers,
          },
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.message || data.error?.message ||
              `Request failed (${response.status})`
          );
        }

        return data;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(
            "Request timed out. Check that the backend is running."
          );
        }

        if (error instanceof TypeError) {
          throw new Error(
            `Cannot reach ${API}. Check the backend and API URL.`
          );
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    []
  );

  const refreshData = useCallback(
    async (authToken: string) => {
      const [loanData, summaryData] = await Promise.all([
        apiRequest("/api/loans", {}, authToken),
        apiRequest("/api/summary", {}, authToken),
      ]);

      setLoans(Array.isArray(loanData) ? loanData : loanData.loans || []);
      setSummary(summaryData);
    },
    [apiRequest]
  );

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(TOKEN_KEY)
      .then(async (saved) => {
        if (!active || !saved) return;

        try {
          await refreshData(saved);
          if (active) setToken(saved);
        } catch {
          await AsyncStorage.removeItem(TOKEN_KEY);
          if (active) setToken(null);
        }
      })
      .catch((error) =>
        console.error("Session restore failed:", error)
      );

    return () => {
      active = false;
    };
  }, [refreshData]);

  useEffect(() => {
    if (!token) return;

    refreshData(token).catch((error) => {
      notify(
        error instanceof Error ? error.message : "Could not load loans.",
        "error"
      );
    });
  }, [token, refreshData]);

  async function sendOtp() {
    setMessage("");
    const cleanPhone = phone.trim();

    if (!/^\+?[1-9]\d{9,14}$/.test(cleanPhone)) {
      notify("Enter a valid phone number with country code.", "error");
      return;
    }

    setLoading(true);

    try {
      await apiRequest("/api/auth/send-otp", {
        method: "POST",
        body: JSON.stringify({ phone: cleanPhone }),
      });

      setOtpSent(true);
      setOtp("");
      notify("Your login code is ready. Check the backend terminal.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not send OTP.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setMessage("");

    if (!/^\d{6}$/.test(otp.trim())) {
      notify("Enter the six-digit OTP from the backend terminal.", "error");
      return;
    }

    setLoading(true);

    try {
      const data = await apiRequest("/api/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({
          phone: phone.trim(),
          otp: otp.trim(),
        }),
      });

      await AsyncStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      notify("Welcome to MiniLedger.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "OTP verification failed.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  async function addLoan() {
    const numericAmount = Number(amount);

    if (!friendName.trim()) {
      notify("Enter your friend's name.", "error");
      return;
    }

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      notify("Enter an amount greater than zero.", "error");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      notify("Enter the due date as YYYY-MM-DD.", "error");
      return;
    }

    const [year, month, day] = dueDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      notify("Enter a valid calendar date.", "error");
      return;
    }

    if (!token) {
      notify("Please sign in again.", "error");
      return;
    }

    setLoading(true);

    try {
      await apiRequest(
        "/api/loans",
        {
          method: "POST",
          body: JSON.stringify({
            friendName: friendName.trim(),
            amount: numericAmount,
            dueDate,
          }),
        },
        token
      );

      setFriendName("");
      setAmount("");
      setDueDate("");
      setShowForm(false);

      await refreshData(token);
      notify("Loan saved successfully.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save loan.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  async function repayLoan(loan: Loan) {
    if (!token) return;

    const performRepayment = async () => {
      setLoading(true);

      try {
        await apiRequest(
          `/api/loans/${loan.id}/repay`,
          { method: "PATCH" },
          token
        );

        await refreshData(token);
        notify(`${loan.friend_name}'s loan marked as repaid.`);
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Repayment failed.",
          "error"
        );
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(`Mark ${loan.friend_name}'s loan as repaid?`)) {
        await performRepayment();
      }
    } else {
      Alert.alert(
        "Confirm repayment",
        `Mark ${loan.friend_name}'s loan as repaid?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Confirm",
            onPress: () => void performRepayment(),
          },
        ]
      );
    }
  }

  async function logout() {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setOtp("");
    setOtpSent(false);
    setLoans([]);
    setSummary(emptySummary);
    setMessage("");
  }

  async function refresh() {
    if (!token) return;

    setRefreshing(true);

    try {
      await refreshData(token);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Refresh failed.",
        "error"
      );
    } finally {
      setRefreshing(false);
    }
  }

  if (!token) {
    return (
      <View style={styles.loginPage}>
        <StatusBar barStyle="dark-content" />

        <ScrollView
          contentContainerStyle={styles.loginScroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.loginLayout}>
            <View style={styles.loginIntro}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>m.</Text>
              </View>

              <Text style={styles.brandName}>mini ledger</Text>

              <Text style={styles.heroTitle}>
                Money between{"\n"}
                <Text style={styles.heroAccent}>friends, made simple.</Text>
              </Text>

              <Text style={styles.heroDescription}>
                Keep track of what you lend, what comes back, and what needs
                a gentle reminder.
              </Text>

              <View style={styles.trustRow}>
                <Text style={styles.trustDot}>●</Text>
                <Text style={styles.trustText}>Private to your account</Text>
                <Text style={styles.trustDot}>●</Text>
                <Text style={styles.trustText}>Always in the loop</Text>
              </View>
            </View>

            <View style={styles.loginCard}>
              <Text style={styles.cardEyebrow}>YOUR MONEY, YOUR RULES</Text>
              <Text style={styles.loginTitle}>Welcome back.</Text>

              <Text style={styles.loginDescription}>
                Enter your phone number and we'll get you signed in.
              </Text>

              <Text style={styles.label}>PHONE NUMBER</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 98765 43210"
                keyboardType="phone-pad"
                autoCapitalize="none"
                style={styles.input}
                editable={!loading}
              />

              {otpSent && (
                <>
                  <Text style={styles.label}>VERIFICATION CODE</Text>
                  <TextInput
                    value={otp}
                    onChangeText={setOtp}
                    placeholder="Enter 6-digit OTP"
                    keyboardType="number-pad"
                    maxLength={6}
                    style={styles.input}
                    editable={!loading}
                  />

                  <Pressable onPress={() => void sendOtp()} disabled={loading}>
                    <Text style={styles.resendLink}>Send a new code</Text>
                  </Pressable>
                </>
              )}

              {message !== "" && (
                <View
                  style={[
                    styles.notice,
                    messageType === "error"
                      ? styles.noticeError
                      : styles.noticeSuccess,
                  ]}
                >
                  <Text style={styles.noticeText}>{message}</Text>
                </View>
              )}

              <Pressable
                style={[
                  styles.primaryButton,
                  loading && styles.buttonDisabled,
                ]}
                disabled={loading}
                onPress={() => void (otpSent ? verifyOtp() : sendOtp())}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {otpSent ? "Verify and continue  →" : "Send login code  →"}
                  </Text>
                )}
              </Pressable>

              <Text style={styles.privacyNote}>
                Demo mode · Your OTP is printed in the backend terminal.
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.dashboard}>
      <StatusBar barStyle="dark-content" />

      <ScrollView
        contentContainerStyle={styles.dashboardContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
        }
      >
        <View style={styles.dashboardHeader}>
          <View style={styles.headerBrand}>
            <View style={styles.smallMark}>
              <Text style={styles.smallMarkText}>m.</Text>
            </View>
            <View>
              <Text style={styles.brandNameSmall}>mini ledger</Text>
              <Text style={styles.headerSubtitle}>YOUR PERSONAL LEDGER</Text>
            </View>
          </View>

          <Pressable style={styles.logoutButton} onPress={() => void logout()}>
            <Text style={styles.logoutText}>Sign out ↗</Text>
          </Pressable>
        </View>

        <View style={styles.welcomeRow}>
          <View style={styles.welcomeText}>
            <Text style={styles.dateEyebrow}>YOUR FINANCIAL SNAPSHOT</Text>
            <Text style={styles.dashboardTitle}>
              The money{"\n"}you've put out there.
            </Text>
          </View>
          <View style={styles.roundDecoration}>
            <Text style={styles.roundDecorationText}>↗</Text>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <Text style={styles.summaryLabel}>TOTAL LENT</Text>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>LIVE SUMMARY</Text>
            </View>
          </View>

          <Text style={styles.totalAmount}>{money(summary.total_lent)}</Text>
          <Text style={styles.summaryCaption}>
            Across all your tracked loans
          </Text>

          <View style={styles.summaryDivider} />

          <View style={styles.summaryMetrics}>
            <View style={styles.summaryMetric}>
              <Text style={styles.metricLabel}>PAID BACK</Text>
              <Text style={styles.metricValue}>
                {money(summary.total_repaid)}
              </Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.summaryMetric}>
              <Text style={styles.metricLabel}>OVERDUE</Text>
              <Text style={styles.metricValueOverdue}>
                {money(summary.overdue_amount)}
              </Text>
            </View>
          </View>
        </View>

        {message !== "" && (
          <View
            style={[
              styles.notice,
              messageType === "error"
                ? styles.noticeError
                : styles.noticeSuccess,
            ]}
          >
            <Text style={styles.noticeText}>{message}</Text>
          </View>
        )}

        <View style={styles.listHeader}>
          <View>
            <Text style={styles.sectionTitle}>The people</Text>
            <Text style={styles.sectionSubtitle}>
              Your lending circle · {loans.length}{" "}
              {loans.length === 1 ? "entry" : "entries"}
            </Text>
          </View>

          <Pressable
            onPress={() => {
              setShowForm(!showForm);
              setMessage("");
            }}
            style={styles.addButton}
          >
            <Text style={styles.addButtonText}>
              {showForm ? "Cancel ×" : "+ New loan"}
            </Text>
          </Pressable>
        </View>

        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Add a little detail.</Text>
            <Text style={styles.formSubtitle}>
              We'll keep it all in one place.
            </Text>

            <Text style={styles.label}>FRIEND'S NAME</Text>
            <TextInput
              value={friendName}
              onChangeText={setFriendName}
              placeholder="e.g. Rahul"
              style={styles.input}
              editable={!loading}
            />

            <Text style={styles.label}>AMOUNT IN RUPEES</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="₹ 1,500"
              keyboardType="decimal-pad"
              style={styles.input}
              editable={!loading}
            />

            <Text style={styles.label}>DUE DATE</Text>
            <TextInput
              value={dueDate}
              onChangeText={setDueDate}
              placeholder="YYYY-MM-DD"
              style={styles.input}
              editable={!loading}
            />

            <Pressable
              style={[
                styles.primaryButton,
                loading && styles.buttonDisabled,
              ]}
              disabled={loading}
              onPress={() => void addLoan()}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  Save this loan  →
                </Text>
              )}
            </Pressable>
          </View>
        )}

        {loans.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptySymbol}>↗</Text>
            <Text style={styles.emptyTitle}>A clean slate.</Text>
            <Text style={styles.emptyDescription}>
              Add your first loan and start keeping track without the awkward
              reminders.
            </Text>
          </View>
        ) : (
          loans.map((loan) => (
            <View
              key={loan.id}
              style={[
                styles.loanCard,
                loan.is_overdue &&
                  !loan.is_repaid &&
                  styles.loanCardOverdue,
              ]}
            >
              <View style={styles.loanTop}>
                <View
                  style={[
                    styles.avatar,
                    loan.is_overdue &&
                      !loan.is_repaid &&
                      styles.avatarOverdue,
                  ]}
                >
                  <Text style={styles.avatarText}>
                    {loan.friend_name.trim().charAt(0).toUpperCase()}
                  </Text>
                </View>

                <View style={styles.loanInfo}>
                  <Text style={styles.friendName}>{loan.friend_name}</Text>
                  <Text style={styles.dueText}>
                    Due {formatDate(loan.due_date)}
                  </Text>
                </View>

                <View style={styles.loanAmountWrap}>
                  <Text style={styles.loanAmount}>{money(loan.amount)}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      loan.is_repaid
                        ? styles.repaidBadge
                        : loan.is_overdue
                        ? styles.overdueBadge
                        : styles.pendingBadge,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        loan.is_repaid
                          ? styles.repaidText
                          : loan.is_overdue
                          ? styles.overdueText
                          : styles.pendingText,
                      ]}
                    >
                      {loan.is_repaid
                        ? "REPAID"
                        : loan.is_overdue
                        ? "OVERDUE"
                        : "PENDING"}
                    </Text>
                  </View>
                </View>
              </View>

              {loan.is_overdue && !loan.is_repaid && (
                <Text style={styles.overdueHint}>
                  This one is past its due date.
                </Text>
              )}

              {!loan.is_repaid && (
                <Pressable
                  style={styles.repayButton}
                  disabled={loading}
                  onPress={() => void repayLoan(loan)}
                >
                  <Text style={styles.repayButtonText}>
                    ✓  Mark as repaid
                  </Text>
                </Pressable>
              )}
            </View>
          ))
        )}

        <View style={styles.footer}>
          <Text style={styles.footerBrand}>mini ledger.</Text>
          <Text style={styles.footerText}>GOOD FRIENDS. CLEAR RECORDS.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  loginPage: {
    flex: 1,
    backgroundColor: "#F5F4EE",
  },
  loginScroll: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loginLayout: {
    width: "100%",
    maxWidth: 1060,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 44,
  },
  loginIntro: {
    flex: 1,
    minWidth: 280,
    maxWidth: 450,
    paddingVertical: 24,
  },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#183D30",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },
  brandMarkText: {
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "900",
    fontFamily: "Georgia",
  },
  brandName: {
    color: "#183D30",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  heroTitle: {
    color: "#183D30",
    fontSize: 46,
    fontFamily: "Georgia",
    letterSpacing: -1.5,
    lineHeight: 53,
    marginTop: 42,
  },
  heroAccent: {
    color: "#578368",
    fontFamily: "Georgia",
    fontStyle: "italic",
  },
  heroDescription: {
    color: "#73796F",
    fontSize: 15,
    lineHeight: 24,
    maxWidth: 360,
    marginTop: 18,
  },
  trustRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 9,
    marginTop: 30,
  },
  trustDot: {
    color: "#56836A",
    fontSize: 8,
  },
  trustText: {
    color: "#697166",
    fontSize: 11,
    fontWeight: "600",
  },
  loginCard: {
    flex: 1,
    minWidth: 290,
    maxWidth: 420,
    backgroundColor: "#FFFEFA",
    borderRadius: 24,
    padding: 30,
    borderWidth: 1,
    borderColor: "#E7E8DF",
  },
  cardEyebrow: {
    color: "#7A857A",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  loginTitle: {
    color: "#183D30",
    fontFamily: "Georgia",
    fontSize: 31,
    marginTop: 13,
  },
  loginDescription: {
    color: "#7A8179",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
    marginBottom: 20,
  },
  label: {
    color: "#70796F",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#FAFAF6",
    borderWidth: 1,
    borderColor: "#E1E5DB",
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: "#183D30",
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: "#183D30",
    borderRadius: 11,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
    marginTop: 20,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  privacyNote: {
    color: "#92988D",
    fontSize: 10,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 19,
  },
  resendLink: {
    color: "#447355",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 10,
  },
  notice: {
    padding: 12,
    borderRadius: 10,
    marginTop: 15,
  },
  noticeSuccess: {
    backgroundColor: "#E9F4EA",
    borderWidth: 1,
    borderColor: "#D3E9D6",
  },
  noticeError: {
    backgroundColor: "#FBECE8",
    borderWidth: 1,
    borderColor: "#F2D0C8",
  },
  noticeText: {
    color: "#38483A",
    fontSize: 12,
    lineHeight: 18,
  },
  dashboard: {
    flex: 1,
    backgroundColor: "#F5F4EE",
  },
  dashboardContent: {
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 50,
    width: "100%",
    maxWidth: 940,
    alignSelf: "center",
  },
  dashboardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 40,
  },
  headerBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  smallMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#183D30",
    alignItems: "center",
    justifyContent: "center",
  },
  smallMarkText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 21,
    fontFamily: "Georgia",
  },
  brandNameSmall: {
    color: "#183D30",
    fontWeight: "800",
    fontSize: 16,
    fontFamily: "Georgia",
  },
  headerSubtitle: {
    color: "#81877D",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 4,
  },
  logoutButton: {
    borderWidth: 1,
    borderColor: "#DDE1D7",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  logoutText: {
    color: "#5B685C",
    fontSize: 11,
    fontWeight: "700",
  },
  welcomeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 25,
  },
  welcomeText: {
    flex: 1,
  },
  dateEyebrow: {
    color: "#7C867A",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 11,
  },
  dashboardTitle: {
    color: "#183D30",
    fontFamily: "Georgia",
    fontSize: 32,
    lineHeight: 39,
  },
  roundDecoration: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#E1E9DA",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  roundDecorationText: {
    color: "#3C704E",
    fontSize: 27,
  },
  summaryCard: {
    backgroundColor: "#183D30",
    borderRadius: 22,
    padding: 25,
    marginBottom: 37,
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  summaryLabel: {
    color: "#BDD1C1",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#52705D",
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#A5D5A7",
  },
  liveBadgeText: {
    color: "#D0DFD1",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  totalAmount: {
    color: "#FFFFFF",
    fontFamily: "Georgia",
    fontSize: 39,
    marginTop: 13,
  },
  summaryCaption: {
    color: "#C0D0C2",
    fontSize: 11,
    marginTop: 5,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: "#42604D",
    marginVertical: 23,
  },
  summaryMetrics: {
    flexDirection: "row",
    gap: 22,
  },
  summaryMetric: {
    flex: 1,
  },
  metricDivider: {
    width: 1,
    backgroundColor: "#42604D",
  },
  metricLabel: {
    color: "#BED0C0",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  metricValue: {
    color: "#FFFFFF",
    fontFamily: "Georgia",
    fontSize: 19,
    marginTop: 8,
  },
  metricValueOverdue: {
    color: "#FFD09D",
    fontFamily: "Georgia",
    fontSize: 19,
    marginTop: 8,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 17,
  },
  sectionTitle: {
    color: "#183D30",
    fontFamily: "Georgia",
    fontSize: 23,
  },
  sectionSubtitle: {
    color: "#7D847A",
    fontSize: 11,
    marginTop: 5,
  },
  addButton: {
    backgroundColor: "#DCE9DB",
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  addButtonText: {
    color: "#214B34",
    fontSize: 12,
    fontWeight: "800",
  },
  formCard: {
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: "#E4E7DD",
    borderRadius: 18,
    padding: 21,
    marginBottom: 17,
  },
  formTitle: {
    color: "#183D30",
    fontFamily: "Georgia",
    fontSize: 21,
  },
  formSubtitle: {
    color: "#81877D",
    fontSize: 12,
    marginTop: 5,
  },
  loanCard: {
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: "#E5E8DE",
    borderRadius: 17,
    padding: 17,
    marginBottom: 11,
  },
  loanCardOverdue: {
    borderColor: "#E9C8BB",
    backgroundColor: "#FFFCF9",
  },
  loanTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#E3EBDD",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarOverdue: {
    backgroundColor: "#F8E4DA",
  },
  avatarText: {
    color: "#2E5C3C",
    fontFamily: "Georgia",
    fontSize: 17,
  },
  loanInfo: {
    flex: 1,
  },
  friendName: {
    color: "#183D30",
    fontSize: 14,
    fontWeight: "800",
  },
  dueText: {
    color: "#838A80",
    fontSize: 10,
    marginTop: 5,
  },
  loanAmountWrap: {
    alignItems: "flex-end",
    gap: 7,
  },
  loanAmount: {
    color: "#183D30",
    fontFamily: "Georgia",
    fontSize: 15,
  },
  statusBadge: {
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 7,
  },
  repaidBadge: {
    backgroundColor: "#E0F1E1",
  },
  overdueBadge: {
    backgroundColor: "#F8E4DB",
  },
  pendingBadge: {
    backgroundColor: "#F5EED9",
  },
  statusText: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  repaidText: {
    color: "#2C6B42",
  },
  overdueText: {
    color: "#A8442E",
  },
  pendingText: {
    color: "#916B24",
  },
  overdueHint: {
    color: "#A44B34",
    fontSize: 11,
    marginTop: 12,
  },
  repayButton: {
    borderTopWidth: 1,
    borderTopColor: "#EBEDE5",
    paddingTop: 13,
    marginTop: 14,
  },
  repayButtonText: {
    color: "#3C704E",
    textAlign: "center",
    fontWeight: "800",
    fontSize: 11,
  },
  emptyCard: {
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: "#E5E8DE",
    borderStyle: "dashed",
    borderRadius: 18,
    padding: 30,
    alignItems: "center",
  },
  emptySymbol: {
    color: "#3B7650",
    fontSize: 34,
  },
  emptyTitle: {
    color: "#183D30",
    fontFamily: "Georgia",
    fontSize: 21,
    marginTop: 8,
  },
  emptyDescription: {
    color: "#7D847A",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 330,
    marginTop: 8,
  },
  footer: {
    alignItems: "center",
    marginTop: 35,
  },
  footerBrand: {
    color: "#183D30",
    fontFamily: "Georgia",
    fontSize: 16,
  },
  footerText: {
    color: "#93988E",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 6,
  },
});