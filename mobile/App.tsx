import React, {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  Pressable,
  PressableStateCallbackType,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DUE_PRESETS,
  addDaysString,
  defaultDueDate,
  dueNote,
  findExistingLoans,
  formatDate,
  validateDueDate,
} from "./loanUtils";

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


type LoanStatus = "outstanding" | "overdue" | "repaid";
type PressState = PressableStateCallbackType & { hovered?: boolean };

function loanStatus(loan: Loan): LoanStatus {
  return loan.is_repaid ? "repaid" : loan.is_overdue ? "overdue" : "outstanding";
}

const AVATAR_TONES = [
  { bg: "#DDEBD8", fg: "#2E5C3C" },
  { bg: "#F7E4C3", fg: "#8A5A12" },
  { bg: "#F8DDD3", fg: "#A8442E" },
  { bg: "#DCE6F2", fg: "#35557E" },
  { bg: "#EADFF2", fg: "#6A4A86" },
];

function avatarTone(name: string) {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return AVATAR_TONES[sum % AVATAR_TONES.length];
}

// Gentle fade-and-rise when a block first appears.
function FadeIn({
  delay = 0,
  style,
  children,
}: {
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    const native = Platform.OS !== "web";
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, delay, useNativeDriver: native }),
      Animated.timing(lift, { toValue: 0, duration: 420, delay, useNativeDriver: native }),
    ]).start();
  }, [delay, lift, opacity]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY: lift }] }]}>
      {children}
    </Animated.View>
  );
}

function Input(props: TextInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      placeholderTextColor="#A3A99E"
      {...props}
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      style={[styles.input, focused && styles.inputFocused, props.style]}
    />
  );
}

function Notice({ text, type }: { text: string; type: "success" | "error" }) {
  const isError = type === "error";

  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, isError ? styles.noticeError : styles.noticeSuccess]}
    >
      <Text
        style={[
          styles.noticeIcon,
          isError ? styles.noticeIconError : styles.noticeIconSuccess,
        ]}
      >
        {isError ? "!" : "✓"}
      </Text>
      <Text
        style={[
          styles.noticeText,
          isError ? styles.noticeTextError : styles.noticeTextSuccess,
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const compact = width < 400;
  const wide = width >= 768;
  const twoColumns = width >= 900;

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
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [filter, setFilter] = useState<"all" | LoanStatus>("all");

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

    const cleanDueDate = dueDate.trim();
    const dueDateProblem = validateDueDate(cleanDueDate);

    if (dueDateProblem) {
      notify(dueDateProblem, "error");
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
            dueDate: cleanDueDate,
          }),
        },
        token
      );

      setFriendName("");
      setAmount("");
      setDueDate(defaultDueDate());
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

  const dueDateTrim = dueDate.trim();
  const existingLoans = showForm ? findExistingLoans(friendName, loans) : [];
  const existingUnpaid = existingLoans.filter((l) => !l.is_repaid);
  const existingUnpaidTotal = existingUnpaid.reduce(
    (sum, l) => sum + Number(l.amount || 0),
    0
  );
  const dueDateError = validateDueDate(dueDateTrim);
  const dueDatePreview = dueDateError ? null : formatDate(dueDateTrim);

  const lent = Number(summary.total_lent || 0);
  const repaidTotal = Number(summary.total_repaid || 0);
  const outstandingTotal = Math.max(0, lent - repaidTotal);
  const paidPct = lent > 0 ? Math.min(100, Math.round((repaidTotal / lent) * 100)) : 0;
  const counts = {
    all: loans.length,
    outstanding: loans.filter((l) => loanStatus(l) === "outstanding").length,
    overdue: loans.filter((l) => loanStatus(l) === "overdue").length,
    repaid: loans.filter((l) => loanStatus(l) === "repaid").length,
  };
  const visibleLoans =
    filter === "all" ? loans : loans.filter((l) => loanStatus(l) === filter);
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";
  const FILTERS: { key: "all" | LoanStatus; label: string }[] = [
    { key: "all", label: "All" },
    { key: "outstanding", label: "Outstanding" },
    { key: "overdue", label: "Overdue" },
    { key: "repaid", label: "Repaid" },
  ];

  if (!token) {
    return (
      <View style={styles.loginPage}>
        <StatusBar barStyle="dark-content" />
        <View pointerEvents="none" style={styles.blobTop} />
        <View pointerEvents="none" style={styles.blobBottom} />

        <ScrollView
          contentContainerStyle={[
            styles.loginScroll,
            compact && styles.loginScrollCompact,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.loginLayout, compact && styles.loginLayoutCompact]}>
            <FadeIn style={[styles.loginIntro, compact && styles.minWidthZero]}>
              <View style={styles.brandRow}>
                <View style={styles.brandMark}>
                  <Text style={styles.brandMarkText}>m.</Text>
                </View>
                <Text style={styles.brandName}>mini ledger</Text>
              </View>

              <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]}>
                Money between{"\n"}
                <Text style={styles.heroAccent}>friends, made simple.</Text>
              </Text>

              <Text style={styles.heroDescription}>
                Keep track of what you lend, what comes back, and what needs
                a gentle reminder.
              </Text>

              <View style={styles.trustRow}>
                <View style={styles.trustChip}>
                  <View style={styles.trustDot} />
                  <Text style={styles.trustText}>Private to your account</Text>
                </View>
                <View style={styles.trustChip}>
                  <View style={styles.trustDot} />
                  <Text style={styles.trustText}>Always in the loop</Text>
                </View>
              </View>

              {width >= 520 && (
                <View pointerEvents="none" style={styles.previewStack}>
                  <View style={[styles.previewCard, styles.previewBack]}>
                    <View style={[styles.avatarSmall, { backgroundColor: "#DDEBD8" }]}>
                      <Text style={[styles.avatarSmallText, { color: "#2E5C3C" }]}>P</Text>
                    </View>
                    <View style={styles.previewInfo}>
                      <Text style={styles.previewName}>Priya</Text>
                      <Text style={styles.previewSub}>Paid back ✓</Text>
                    </View>
                    <Text style={styles.previewAmount}>₹800</Text>
                  </View>
                  <View style={[styles.previewCard, styles.previewFront]}>
                    <View style={[styles.avatarSmall, { backgroundColor: "#F7E4C3" }]}>
                      <Text style={[styles.avatarSmallText, { color: "#8A5A12" }]}>R</Text>
                    </View>
                    <View style={styles.previewInfo}>
                      <Text style={styles.previewName}>Rahul</Text>
                      <Text style={styles.previewSub}>Due in 3 days</Text>
                    </View>
                    <Text style={styles.previewAmount}>₹1,500</Text>
                  </View>
                  <Text style={styles.previewLabel}>SAMPLE PREVIEW</Text>
                </View>
              )}
            </FadeIn>

            <FadeIn delay={120} style={[styles.loginCard, compact && styles.loginCardCompact]}>
              <View style={styles.cardAccent} />
              <Text style={styles.cardEyebrow}>YOUR MONEY, YOUR RULES</Text>
              <Text style={styles.loginTitle}>Welcome back.</Text>

              <Text style={styles.loginDescription}>
                Enter your phone number and we'll get you signed in.
              </Text>

              <Text style={styles.label}>PHONE NUMBER</Text>
              <Input
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
                  <Input
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

              {message !== "" && <Notice text={message} type={messageType} />}

              <Pressable
                accessibilityRole="button"
                style={({ pressed, hovered }: PressState) => [
                  styles.primaryButton,
                  hovered && styles.primaryHover,
                  loading && styles.buttonDisabled,
                  pressed && styles.pressed,
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
            </FadeIn>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.dashboard}>
      <StatusBar barStyle="dark-content" />
      <View pointerEvents="none" style={styles.blobTop} />

      <ScrollView
        contentContainerStyle={[
          styles.dashboardContent,
          { paddingHorizontal: compact ? 16 : wide ? 32 : 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
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

          <Pressable
            accessibilityRole="button"
            style={({ pressed, hovered }: PressState) => [
              styles.logoutButton,
              hovered && styles.logoutHover,
              pressed && styles.pressed,
            ]}
            onPress={() => void logout()}
          >
            <Text style={styles.logoutText}>Sign out ↗</Text>
          </Pressable>
        </View>

        <FadeIn style={styles.welcomeRow}>
          <View style={styles.welcomeText}>
            <Text style={styles.dateEyebrow}>{greeting} · YOUR SNAPSHOT</Text>
            <Text style={[styles.dashboardTitle, compact && styles.dashboardTitleCompact]}>
              The money{"\n"}
              <Text style={styles.heroAccent}>you've put out there.</Text>
            </Text>
          </View>
          <View style={styles.roundDecoration}>
            <Text style={styles.roundDecorationText}>↗</Text>
          </View>
        </FadeIn>

        <FadeIn delay={90} style={styles.summaryCard}>
          <View pointerEvents="none" style={styles.summaryCircleA} />
          <View pointerEvents="none" style={styles.summaryCircleB} />

          <View style={styles.summaryTop}>
            <Text style={styles.summaryLabel}>TOTAL LENT</Text>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>LIVE SUMMARY</Text>
            </View>
          </View>

          <Text style={[styles.totalAmount, compact && styles.totalAmountCompact]}>
            {money(summary.total_lent)}
          </Text>
          <Text style={styles.summaryCaption}>Across all your tracked loans</Text>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${paidPct}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{paidPct}% paid back so far</Text>

          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <View style={styles.tileHead}>
                <View style={[styles.tileDot, { backgroundColor: "#8FD1A0" }]} />
                <Text style={styles.tileLabel}>PAID BACK</Text>
              </View>
              <Text style={styles.tileValue}>{money(summary.total_repaid)}</Text>
            </View>
            <View style={styles.tile}>
              <View style={styles.tileHead}>
                <View style={[styles.tileDot, { backgroundColor: "#F1C76B" }]} />
                <Text style={styles.tileLabel}>OUTSTANDING</Text>
              </View>
              <Text style={styles.tileValue}>{money(outstandingTotal)}</Text>
            </View>
            <View style={styles.tile}>
              <View style={styles.tileHead}>
                <View style={[styles.tileDot, { backgroundColor: "#F0907A" }]} />
                <Text style={styles.tileLabel}>OVERDUE</Text>
              </View>
              <Text style={[styles.tileValue, { color: "#FFD09D" }]}>
                {money(summary.overdue_amount)}
              </Text>
            </View>
          </View>
        </FadeIn>

        {message !== "" && !showForm && <Notice text={message} type={messageType} />}

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
              if (!showForm) setDueDate(defaultDueDate());
              setShowForm(!showForm);
              setMessage("");
            }}
            accessibilityRole="button"
            style={({ pressed, hovered }: PressState) => [
              styles.addButton,
              showForm && styles.addButtonCancel,
              hovered && styles.addButtonHover,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.addButtonText, showForm && styles.addButtonTextCancel]}>
              {showForm ? "Cancel ×" : "+ New loan"}
            </Text>
          </Pressable>
        </View>

        {showForm && (
          <FadeIn style={[styles.formCard, wide && styles.formCardWide]}>
            <Text style={styles.formTitle}>Add a little detail.</Text>
            <Text style={styles.formSubtitle}>We'll keep it all in one place.</Text>

            <Text style={styles.label}>FRIEND'S NAME</Text>
            <Input
              value={friendName}
              onChangeText={setFriendName}
              placeholder="e.g. Rahul"
              style={styles.input}
              editable={!loading}
            />

            {existingLoans.length > 0 && (
              <View style={styles.dupWarning} accessibilityRole="alert">
                <Text style={styles.dupIcon}>!</Text>
                <Text style={styles.dupText}>
                  You already have {existingLoans.length}{" "}
                  {existingLoans.length === 1 ? "loan" : "loans"} for{" "}
                  {existingLoans[0].friend_name}
                  {existingUnpaid.length > 0
                    ? ` (${money(existingUnpaidTotal)} still outstanding)`
                    : " (all repaid)"}
                  . You can still save this one.
                </Text>
              </View>
            )}

            <Text style={styles.label}>AMOUNT IN RUPEES</Text>
            <Input
              value={amount}
              onChangeText={setAmount}
              placeholder="₹ 1,500"
              keyboardType="decimal-pad"
              style={styles.input}
              editable={!loading}
            />

            <Text style={styles.label}>DUE DATE</Text>
            <Input
              value={dueDate}
              onChangeText={setDueDate}
              placeholder="YYYY-MM-DD"
              maxLength={10}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
              style={styles.input}
              editable={!loading}
            />

            <View style={styles.presetRow}>
              {DUE_PRESETS.map((preset) => {
                const presetValue = addDaysString(preset.days);
                const active = dueDateTrim === presetValue;

                return (
                  <Pressable
                    key={preset.label}
                    accessibilityRole="button"
                    disabled={loading}
                    onPress={() => setDueDate(presetValue)}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text
              style={[
                styles.dateHint,
                dueDateTrim.length >= 10 && dueDateError ? styles.dateHintError : null,
              ]}
            >
              {dueDatePreview
                ? `Due ${dueDatePreview}. Past dates are allowed.`
                : dueDateTrim.length < 10
                ? "Use the format YYYY-MM-DD."
                : dueDateError}
            </Text>

            {message !== "" && <Notice text={message} type={messageType} />}

            <Pressable
              accessibilityRole="button"
              style={({ pressed, hovered }: PressState) => [
                styles.primaryButton,
                hovered && styles.primaryHover,
                loading && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
              disabled={loading}
              onPress={() => void addLoan()}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Save this loan  →</Text>
              )}
            </Pressable>
          </FadeIn>
        )}

        {loans.length > 0 && (
          <View style={styles.filterRow}>
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  accessibilityRole="button"
                  onPress={() => setFilter(f.key)}
                  style={({ pressed }) => [
                    styles.pill,
                    active && styles.pillActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>
                    {f.label} · {counts[f.key]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {visibleLoans.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptySymbol}>↗</Text>
            <Text style={styles.emptyTitle}>
              {loans.length === 0 ? "A clean slate." : "Nothing here."}
            </Text>
            <Text style={styles.emptyDescription}>
              {loans.length === 0
                ? "Add your first loan and start keeping track without the awkward reminders."
                : "No loans match this filter right now."}
            </Text>
          </View>
        ) : (
          <View style={styles.loanGrid}>
            {visibleLoans.map((loan, index) => {
              const status = loanStatus(loan);
              const tone = avatarTone(loan.friend_name);
              const note = dueNote(loan);

              return (
                <FadeIn
                  key={loan.id}
                  delay={Math.min(index, 8) * 60}
                  style={twoColumns ? styles.loanCardHalf : styles.loanCardFull}
                >
                  <View
                    style={[
                      styles.loanCard,
                      status === "repaid"
                        ? styles.loanCardRepaid
                        : status === "overdue"
                        ? styles.loanCardOverdue
                        : styles.loanCardOutstanding,
                    ]}
                  >
                    <View style={styles.loanTop}>
                      <View style={[styles.avatar, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.avatarText, { color: tone.fg }]}>
                          {loan.friend_name.trim().charAt(0).toUpperCase()}
                        </Text>
                      </View>

                      <View style={styles.loanInfo}>
                        <Text style={styles.friendName} numberOfLines={2}>
                          {loan.friend_name}
                        </Text>
                        <Text style={styles.dueText}>
                          Due {formatDate(loan.due_date)}
                        </Text>
                      </View>

                      <View style={styles.loanAmountWrap}>
                        <Text style={styles.loanAmount}>{money(loan.amount)}</Text>
                        <View
                          style={[
                            styles.statusBadge,
                            status === "repaid"
                              ? styles.repaidBadge
                              : status === "overdue"
                              ? styles.overdueBadge
                              : styles.pendingBadge,
                          ]}
                        >
                          <View
                            style={[
                              styles.statusDot,
                              {
                                backgroundColor:
                                  status === "repaid"
                                    ? "#3E8E5B"
                                    : status === "overdue"
                                    ? "#D2694C"
                                    : "#D9A441",
                              },
                            ]}
                          />
                          <Text
                            style={[
                              styles.statusText,
                              status === "repaid"
                                ? styles.repaidText
                                : status === "overdue"
                                ? styles.overdueText
                                : styles.pendingText,
                            ]}
                          >
                            {status === "repaid"
                              ? "REPAID"
                              : status === "overdue"
                              ? "OVERDUE"
                              : "OUTSTANDING"}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {status === "repaid" ? (
                      <View style={styles.loanFooter}>
                        <Text style={styles.paidNote}>✓  Settled. All paid back.</Text>
                      </View>
                    ) : (
                      <View style={styles.loanFooter}>
                        <View
                          style={[
                            styles.dueChip,
                            status === "overdue" ? styles.dueChipOver : styles.dueChipOk,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dueChipText,
                              status === "overdue"
                                ? styles.dueChipTextOver
                                : styles.dueChipTextOk,
                            ]}
                          >
                            {note ? note : status === "overdue" ? "past due" : "on track"}
                          </Text>
                        </View>

                        <Pressable
                          accessibilityRole="button"
                          style={({ pressed, hovered }: PressState) => [
                            styles.repayButton,
                            hovered && styles.repayButtonHover,
                            pressed && styles.pressed,
                          ]}
                          disabled={loading}
                          onPress={() => void repayLoan(loan)}
                        >
                          <Text style={styles.repayButtonText}>✓  Mark as repaid</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                </FadeIn>
              );
            })}
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerBrand}>mini ledger.</Text>
          <Text style={styles.footerText}>GOOD FRIENDS. CLEAR RECORDS.</Text>
        </View>
      </ScrollView>
    </View>
  );
}


const SOFT_SHADOW =
  "0 1px 2px rgba(24, 61, 48, 0.06), 0 10px 24px rgba(24, 61, 48, 0.07)";

const styles = StyleSheet.create({
  // ---- shared ----
  pressed: { opacity: 0.82 },
  blobTop: {
    position: "absolute",
    top: -140,
    right: -120,
    width: 440,
    height: 440,
    borderRadius: 220,
    backgroundColor: "#E1EBD9",
    opacity: 0.75,
  },
  blobBottom: {
    position: "absolute",
    bottom: -150,
    left: -130,
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: "#F1E6C9",
    opacity: 0.6,
  },
  label: {
    color: "#5F6B5F",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#FAFAF6",
    borderWidth: 1.5,
    borderColor: "#E1E5DB",
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 14,
    color: "#183D30",
    fontSize: 15,
  },
  inputFocused: { borderColor: "#2F6B4A", backgroundColor: "#FFFFFF" },
  primaryButton: {
    backgroundColor: "#183D30",
    borderRadius: 13,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    marginTop: 20,
    boxShadow: "0 6px 14px rgba(24, 61, 48, 0.25)",
  },
  primaryHover: { backgroundColor: "#245240" },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  buttonDisabled: { opacity: 0.55 },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    marginTop: 15,
  },
  noticeSuccess: { backgroundColor: "#E9F4EA", borderWidth: 1, borderColor: "#D3E9D6" },
  noticeError: { backgroundColor: "#FBECE8", borderWidth: 1, borderColor: "#F2D0C8" },
  noticeIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    overflow: "hidden",
    textAlign: "center",
    fontSize: 11,
    lineHeight: 18,
    fontWeight: "900",
    marginTop: 1,
  },
  noticeIconError: { backgroundColor: "#C4573F", color: "#FFFFFF" },
  noticeIconSuccess: { backgroundColor: "#3C704E", color: "#FFFFFF" },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 19 },
  noticeTextError: { color: "#7E2F1E" },
  noticeTextSuccess: { color: "#27583A" },
  minWidthZero: { minWidth: 0 },

  dupWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FBF1D9",
    borderWidth: 1,
    borderColor: "#F0DDAE",
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  dupIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    overflow: "hidden",
    textAlign: "center",
    fontSize: 11,
    lineHeight: 18,
    fontWeight: "900",
    backgroundColor: "#D9A441",
    color: "#FFFFFF",
    marginTop: 1,
  },
  dupText: { flex: 1, color: "#6E4A0E", fontSize: 13, lineHeight: 19 },

  // ---- login ----
  loginPage: { flex: 1, backgroundColor: "#F5F4EE", overflow: "hidden" },
  loginScroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  loginScrollCompact: { padding: 16 },
  loginLayout: {
    width: "100%",
    maxWidth: 1060,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 48,
  },
  loginLayoutCompact: { gap: 20 },
  loginIntro: { flex: 1, minWidth: 280, maxWidth: 470, paddingVertical: 24 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandMark: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "#183D30",
    justifyContent: "center",
    alignItems: "center",
    boxShadow: "0 8px 18px rgba(24, 61, 48, 0.28)",
  },
  brandMarkText: { color: "#FFFFFF", fontSize: 26, fontWeight: "900", fontFamily: "Georgia" },
  brandName: { color: "#183D30", fontSize: 19, fontWeight: "800", letterSpacing: -0.5 },
  heroTitle: {
    color: "#183D30",
    fontSize: 54,
    fontFamily: "Georgia",
    letterSpacing: -1.8,
    lineHeight: 60,
    marginTop: 40,
  },
  heroTitleCompact: { fontSize: 36, lineHeight: 42, letterSpacing: -1, marginTop: 24 },
  heroAccent: { color: "#4F8A68", fontFamily: "Georgia", fontStyle: "italic" },
  heroDescription: { color: "#6C7368", fontSize: 16, lineHeight: 25, maxWidth: 380, marginTop: 18 },
  trustRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 26 },
  trustChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: "#E4E7DD",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  trustDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#56A073" },
  trustText: { color: "#4F5C50", fontSize: 12, fontWeight: "700" },
  previewStack: { marginTop: 34, height: 150, maxWidth: 380 },
  previewCard: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: "#E4E7DD",
    borderRadius: 16,
    padding: 14,
    boxShadow: SOFT_SHADOW,
  },
  previewBack: { top: 0, left: 22, transform: [{ rotate: "2deg" }], opacity: 0.9 },
  previewFront: { top: 52, right: 22, transform: [{ rotate: "-1.5deg" }] },
  previewInfo: { flex: 1 },
  previewName: { color: "#183D30", fontSize: 14, fontWeight: "800" },
  previewSub: { color: "#838A80", fontSize: 12, marginTop: 3 },
  previewAmount: { color: "#183D30", fontFamily: "Georgia", fontSize: 17 },
  previewLabel: {
    position: "absolute",
    bottom: 0,
    left: 2,
    color: "#A3A99E",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  avatarSmall: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarSmallText: { fontFamily: "Georgia", fontSize: 16 },
  loginCard: {
    flex: 1,
    minWidth: 290,
    maxWidth: 430,
    backgroundColor: "#FFFEFA",
    borderRadius: 26,
    padding: 32,
    paddingTop: 36,
    borderWidth: 1,
    borderColor: "#E7E8DF",
    overflow: "hidden",
    boxShadow: "0 2px 4px rgba(24, 61, 48, 0.06), 0 24px 48px rgba(24, 61, 48, 0.12)",
  },
  loginCardCompact: { padding: 22, paddingTop: 28, minWidth: 0 },
  cardAccent: { position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: "#2F6B4A" },
  cardEyebrow: { color: "#6F7C6F", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  loginTitle: { color: "#183D30", fontFamily: "Georgia", fontSize: 34, marginTop: 12 },
  loginDescription: { color: "#6F766D", fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 12 },
  privacyNote: { color: "#8C9288", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 19 },
  resendLink: { color: "#3C704E", fontSize: 13, fontWeight: "700", marginTop: 12 },

  // ---- dashboard ----
  dashboard: { flex: 1, backgroundColor: "#F5F4EE", overflow: "hidden" },
  dashboardContent: {
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 60,
    width: "100%",
    maxWidth: 1000,
    alignSelf: "center",
  },
  dashboardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 34,
  },
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 11 },
  smallMark: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: "#183D30",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 6px 14px rgba(24, 61, 48, 0.25)",
  },
  smallMarkText: { color: "#FFFFFF", fontWeight: "900", fontSize: 22, fontFamily: "Georgia" },
  brandNameSmall: { color: "#183D30", fontWeight: "800", fontSize: 17, fontFamily: "Georgia" },
  headerSubtitle: { color: "#7B8277", fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginTop: 3 },
  logoutButton: {
    minHeight: 40,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#DDE1D7",
    backgroundColor: "#FFFEFA",
    borderRadius: 999,
    paddingHorizontal: 16,
  },
  logoutHover: { borderColor: "#B9C6B8", backgroundColor: "#F1F5EC" },
  logoutText: { color: "#4F5C50", fontSize: 12, fontWeight: "700" },
  welcomeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  welcomeText: { flex: 1 },
  dateEyebrow: { color: "#6F7C6F", fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginBottom: 11 },
  dashboardTitle: { color: "#183D30", fontFamily: "Georgia", fontSize: 38, lineHeight: 45, letterSpacing: -0.8 },
  dashboardTitleCompact: { fontSize: 28, lineHeight: 34 },
  roundDecoration: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#DCE9DB",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  roundDecorationText: { color: "#2F6B4A", fontSize: 28 },

  summaryCard: {
    backgroundColor: "#183D30",
    borderRadius: 26,
    padding: 28,
    marginBottom: 30,
    overflow: "hidden",
    boxShadow: "0 18px 36px rgba(24, 61, 48, 0.28)",
  },
  summaryCircleA: {
    position: "absolute",
    top: -80,
    right: -50,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "#245240",
    opacity: 0.8,
  },
  summaryCircleB: {
    position: "absolute",
    bottom: -90,
    left: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#1F4838",
    opacity: 0.9,
  },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  summaryLabel: { color: "#BDD1C1", fontSize: 11, fontWeight: "800", letterSpacing: 1.6 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#52705D",
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#A5D5A7" },
  liveBadgeText: { color: "#D0DFD1", fontSize: 9, fontWeight: "800", letterSpacing: 0.7 },
  totalAmount: { color: "#FFFFFF", fontFamily: "Georgia", fontSize: 50, letterSpacing: -1, marginTop: 14 },
  totalAmountCompact: { fontSize: 36 },
  summaryCaption: { color: "#C0D0C2", fontSize: 12, marginTop: 4 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2F5A47",
    overflow: "hidden",
    marginTop: 22,
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: "#8FD1A0" },
  progressLabel: { color: "#C0D0C2", fontSize: 12, marginTop: 8 },
  tileRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 22 },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    borderRadius: 16,
    padding: 15,
  },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  tileDot: { width: 8, height: 8, borderRadius: 4 },
  tileLabel: { color: "#BED0C0", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  tileValue: { color: "#FFFFFF", fontFamily: "Georgia", fontSize: 21, marginTop: 9 },

  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  sectionTitle: { color: "#183D30", fontFamily: "Georgia", fontSize: 27 },
  sectionSubtitle: { color: "#737A6F", fontSize: 12, marginTop: 5 },
  addButton: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: "#183D30",
    borderRadius: 999,
    paddingHorizontal: 18,
    boxShadow: "0 6px 14px rgba(24, 61, 48, 0.25)",
  },
  addButtonHover: { backgroundColor: "#245240" },
  addButtonCancel: { backgroundColor: "#E7ECE0", boxShadow: "none" },
  addButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  addButtonTextCancel: { color: "#3C4F3F" },

  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  pill: {
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#DDE1D7",
    backgroundColor: "#FFFEFA",
    paddingHorizontal: 14,
  },
  pillActive: { backgroundColor: "#183D30", borderColor: "#183D30" },
  pillText: { color: "#4F5C50", fontSize: 12, fontWeight: "700" },
  pillTextActive: { color: "#FFFFFF" },

  formCard: {
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: "#E4E7DD",
    borderLeftWidth: 5,
    borderLeftColor: "#2F6B4A",
    borderRadius: 20,
    padding: 24,
    marginBottom: 18,
    boxShadow: SOFT_SHADOW,
  },
  formCardWide: { maxWidth: 640, width: "100%" },
  formTitle: { color: "#183D30", fontFamily: "Georgia", fontSize: 24 },
  formSubtitle: { color: "#737A6F", fontSize: 13, marginTop: 5 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: {
    minHeight: 34,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#DDE1D7",
    backgroundColor: "#FAFAF6",
    paddingHorizontal: 13,
  },
  chipActive: { backgroundColor: "#183D30", borderColor: "#183D30" },
  chipText: { color: "#4F5C50", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#FFFFFF" },
  dateHint: { color: "#737A6F", fontSize: 12, marginTop: 10 },
  dateHintError: { color: "#A8442E" },

  loanGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  loanCardFull: { width: "100%" },
  loanCardHalf: { width: "48.8%" },
  loanCard: {
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: "#E5E8DE",
    borderLeftWidth: 5,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    boxShadow: SOFT_SHADOW,
  },
  loanCardOutstanding: { borderLeftColor: "#D9A441" },
  loanCardOverdue: { borderColor: "#EDCFC4", borderLeftColor: "#D2694C", backgroundColor: "#FFFAF6" },
  loanCardRepaid: { borderLeftColor: "#3E8E5B", backgroundColor: "#F6FAF3" },
  loanTop: { flexDirection: "row", alignItems: "center", gap: 13 },
  avatar: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: "Georgia", fontSize: 19 },
  loanInfo: { flex: 1, minWidth: 0 },
  friendName: { color: "#183D30", fontSize: 16, fontWeight: "800" },
  dueText: { color: "#737A6F", fontSize: 12, marginTop: 4 },
  loanAmountWrap: { alignItems: "flex-end", gap: 8, flexShrink: 0 },
  loanAmount: { color: "#183D30", fontFamily: "Georgia", fontSize: 19 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  repaidBadge: { backgroundColor: "#DFF1E2" },
  overdueBadge: { backgroundColor: "#FBE3DA" },
  pendingBadge: { backgroundColor: "#FBF0D4" },
  statusText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.7 },
  repaidText: { color: "#2C6B42" },
  overdueText: { color: "#A8442E" },
  pendingText: { color: "#8A5A12" },
  loanFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#ECEEE5",
    paddingTop: 14,
    marginTop: 15,
  },
  dueChip: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  dueChipOk: { backgroundColor: "#F3F1E4" },
  dueChipOver: { backgroundColor: "#FBE3DA" },
  dueChipText: { fontSize: 12, fontWeight: "700" },
  dueChipTextOk: { color: "#6B6A4A" },
  dueChipTextOver: { color: "#A8442E" },
  paidNote: { color: "#2C6B42", fontSize: 12, fontWeight: "700" },
  repayButton: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#3C704E",
    paddingHorizontal: 16,
  },
  repayButtonHover: { backgroundColor: "#E7F1E6" },
  repayButtonText: { color: "#2F6B4A", fontWeight: "800", fontSize: 13 },

  emptyCard: {
    backgroundColor: "#FFFEFA",
    borderWidth: 1.5,
    borderColor: "#E0E4D8",
    borderStyle: "dashed",
    borderRadius: 20,
    padding: 34,
    alignItems: "center",
  },
  emptySymbol: { color: "#3B7650", fontSize: 36 },
  emptyTitle: { color: "#183D30", fontFamily: "Georgia", fontSize: 23, marginTop: 8 },
  emptyDescription: { color: "#737A6F", fontSize: 13, textAlign: "center", lineHeight: 20, maxWidth: 340, marginTop: 8 },
  footer: { alignItems: "center", marginTop: 36 },
  footerBrand: { color: "#183D30", fontFamily: "Georgia", fontSize: 17 },
  footerText: { color: "#8C9288", fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginTop: 6 },
});